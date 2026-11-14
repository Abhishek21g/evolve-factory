//! Deterministic verdict layer of the Certus Factory safety gate.
//!
//! Input (JSON, built by gate/verdict.py): the rule table (safety.json: hazards and safety requirements), the
//! outcome of every gate check, the unit-test result of every requirement the change affects, and the world-model
//! results (simulated patients or aircraft, each flagged by the simulator as inside or outside its safe envelope,
//! on the candidate and on the base branch). Output: PASS or BLOCKED, every requirement with its hazard links and
//! the reason, and SHA-256 digests that tie the verdict to the exact evidence and rule table it was decided on.
//!
//! The verdict is PASS only when no rule below finds a reason to block. Malformed input blocks.
//! gate/verdict.py holds the same rules in Python (the fallback); gate/test_gate.py asserts both agree.
#![forbid(unsafe_code)]
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use sha2::{Digest as _, Sha256};
use std::collections::BTreeSet;

pub const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
struct Input {
    rules: Box<RawValue>,
    #[serde(default)]
    checks: Vec<Check>,
    #[serde(default)]
    requirements: Vec<TestResult>,
    #[serde(default)]
    world: Option<World>,
}

#[derive(Deserialize)]
struct RuleTable {
    hazards: Vec<Hazard>,
    requirements: Vec<Rule>,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
pub struct Hazard {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub severity: String,
}

#[derive(Deserialize)]
struct Rule {
    id: String,
    text: String,
    hazards: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone, PartialEq, Debug)]
pub struct Check {
    pub name: String,
    pub passed: bool,
}

#[derive(Deserialize)]
struct TestResult {
    id: String,
    result: String,
    #[serde(default)]
    why: Vec<String>,
}

#[derive(Deserialize)]
struct World {
    verdict: String,
    results: Vec<Run>,
}

#[derive(Deserialize)]
struct Run {
    scenario: String,
    patient: String,
    hypo: bool,
    new_hypo: bool,
    preexisting: bool,
}

#[derive(Serialize, PartialEq, Debug)]
pub struct Verdict {
    pub engine: &'static str,
    pub verdict: &'static str,
    pub reasons: Vec<String>,
    pub requirements: Vec<RequirementVerdict>,
    pub checks: Vec<Check>,
    pub world: WorldVerdict,
    pub digest: Digests,
}

#[derive(Serialize, PartialEq, Debug)]
pub struct RequirementVerdict {
    pub id: String,
    pub text: String,
    pub hazards: Vec<Hazard>,
    pub affected: bool,
    pub result: String,
    pub pass: bool,
    pub reason: String,
}

#[derive(Serialize, PartialEq, Debug, Default)]
pub struct WorldVerdict {
    pub provided: bool,
    pub runs: usize,
    pub new_exceedances: usize,
    pub preexisting: usize,
    pub pass: bool,
}

#[derive(Serialize, PartialEq, Debug)]
pub struct Digests {
    pub input_sha256: String,
    pub rules_sha256: String,
    pub verdict_sha256: String,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn digests(input: &[u8], rules: &[u8], verdict: &str) -> Digests {
    let input_sha256 = sha256_hex(input);
    let rules_sha256 = if rules.is_empty() { String::new() } else { sha256_hex(rules) };
    let verdict_sha256 = sha256_hex(format!("{input_sha256}:{rules_sha256}:{verdict}").as_bytes());
    Digests { input_sha256, rules_sha256, verdict_sha256 }
}

fn verdict_of(reasons: &[String]) -> &'static str {
    if reasons.is_empty() {
        "PASS"
    } else {
        "BLOCKED"
    }
}

fn rejected(input: &[u8], why: String) -> Verdict {
    let reasons = vec![format!("input rejected: {why}")];
    let verdict = verdict_of(&reasons);
    Verdict {
        engine: "rust",
        verdict,
        digest: digests(input, b"", verdict),
        reasons,
        requirements: Vec::new(),
        checks: Vec::new(),
        world: WorldVerdict::default(),
    }
}

/// Decide the verdict for one gate attempt. Total: every input, however malformed, yields a verdict.
pub fn evaluate(input: &[u8]) -> Verdict {
    if input.len() > MAX_INPUT_BYTES {
        return rejected(input, format!("larger than {MAX_INPUT_BYTES} bytes"));
    }
    let parsed: Input = match serde_json::from_slice(input) {
        Ok(v) => v,
        Err(e) => return rejected(input, e.to_string()),
    };
    let table: RuleTable = match serde_json::from_str(parsed.rules.get()) {
        Ok(v) => v,
        Err(e) => return rejected(input, format!("rule table: {e}")),
    };
    let mut reasons = rule_table_problems(&table);

    for c in parsed.checks.iter().filter(|c| !c.passed) {
        reasons.push(format!("check {} failed", c.name));
    }

    let known: BTreeSet<&str> = table.requirements.iter().map(|r| r.id.as_str()).collect();
    let mut seen = BTreeSet::new();
    for t in &parsed.requirements {
        if !known.contains(t.id.as_str()) {
            reasons.push(format!("test result for {} matches no requirement in the rule table", t.id));
        }
        if !seen.insert(t.id.as_str()) {
            reasons.push(format!("duplicate test result for {}", t.id));
        }
    }

    let mut requirements = Vec::with_capacity(table.requirements.len());
    for r in &table.requirements {
        let hazards: Vec<Hazard> = r.hazards.iter().map(|h| hazard(&table, h)).collect();
        let links = hazards.iter().map(|h| format!("{} {}", h.id, h.title)).collect::<Vec<_>>().join(", ");
        let row = parsed.requirements.iter().find(|t| t.id == r.id);
        let (affected, result, pass, reason) = match row {
            None => (false, "NOT AFFECTED".to_string(), true, "not affected by this change".to_string()),
            Some(t) if t.result == "PASS" => {
                (true, t.result.clone(), true, format!("test passed (triggered by: {})", t.why.join("; ")))
            }
            Some(t) => {
                reasons.push(format!("{} {} ({}; {})", r.id, t.result, r.text, r.hazards.join(", ")));
                (true, t.result.clone(), false, format!("test {}: hazard not mitigated: {links}", t.result))
            }
        };
        requirements.push(RequirementVerdict { id: r.id.clone(), text: r.text.clone(), hazards, affected, result, pass, reason });
    }

    let world = match &parsed.world {
        None => WorldVerdict { pass: true, ..WorldVerdict::default() },
        Some(w) => world_verdict(w, &mut reasons),
    };

    let verdict = verdict_of(&reasons);
    Verdict {
        engine: "rust",
        verdict,
        digest: digests(input, parsed.rules.get().as_bytes(), verdict),
        reasons,
        requirements,
        checks: parsed.checks,
        world,
    }
}

fn hazard(table: &RuleTable, id: &str) -> Hazard {
    table.hazards.iter().find(|h| h.id == id).cloned().unwrap_or_else(|| Hazard {
        id: id.to_string(),
        title: "?".to_string(),
        severity: String::new(),
    })
}

fn rule_table_problems(table: &RuleTable) -> Vec<String> {
    let mut out = Vec::new();
    let mut ids = BTreeSet::new();
    for h in &table.hazards {
        if !ids.insert(h.id.as_str()) {
            out.push(format!("rule table: duplicate hazard {}", h.id));
        }
    }
    let mut srs = BTreeSet::new();
    for r in &table.requirements {
        if !srs.insert(r.id.as_str()) {
            out.push(format!("rule table: duplicate requirement {}", r.id));
        }
        if r.hazards.is_empty() {
            out.push(format!("rule table: {} links no hazard", r.id));
        }
        for h in r.hazards.iter().filter(|h| !ids.contains(h.as_str())) {
            out.push(format!("rule table: {} links unknown hazard {h}", r.id));
        }
    }
    out
}

/// Non-regression: BLOCKED if any run leaves its safe envelope on the candidate but not on the base branch.
/// The simulator's own flags are cross-checked; inconsistent evidence blocks.
fn world_verdict(w: &World, reasons: &mut Vec<String>) -> WorldVerdict {
    let before = reasons.len();
    for r in &w.results {
        let consistent = r.new_hypo == (r.hypo && !r.preexisting) && (r.hypo || !r.preexisting);
        if !consistent {
            reasons.push(format!("world model: inconsistent flags for {}/{}", r.scenario, r.patient));
        }
    }
    let new_exceedances = w.results.iter().filter(|r| r.hypo && !r.preexisting).count();
    let preexisting = w.results.iter().filter(|r| r.hypo && r.preexisting).count();
    if w.results.is_empty() {
        reasons.push("world model: no simulated runs".to_string());
    }
    let computed = if new_exceedances == 0 { "PASS" } else { "BLOCKED" };
    if w.verdict != computed {
        reasons.push(format!("world model: reported {} but its runs say {computed}", w.verdict));
    }
    if new_exceedances > 0 {
        reasons.push(format!("world model: {new_exceedances} new exceedance(s) caused by this change"));
    }
    WorldVerdict {
        provided: true,
        runs: w.results.len(),
        new_exceedances,
        preexisting,
        pass: reasons.len() == before,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn pump_rules() -> Value {
        json!({"hazards": [
            {"id": "H-1", "title": "Insulin overdose (single bolus)", "severity": "S3"},
            {"id": "H-2", "title": "Cumulative daily overdose", "severity": "S3"},
            {"id": "H-3", "title": "Hypoglycemia from bolus at low BG", "severity": "S3"}],
          "requirements": [
            {"id": "SR-1", "text": "Single bolus never exceeds 10 U", "hazards": ["H-1"]},
            {"id": "SR-2", "text": "Daily total never exceeds 60 U", "hazards": ["H-2"]},
            {"id": "SR-3", "text": "No bolus when BG below 70 mg/dL", "hazards": ["H-3"]}]})
    }

    fn run(hypo: bool, preexisting: bool) -> Value {
        json!({"scenario": "large-meal", "patient": "adult#001", "hypo": hypo,
               "new_hypo": hypo && !preexisting, "preexisting": preexisting})
    }

    fn input(results: [&str; 3], runs: Vec<Value>, world_verdict: &str) -> Value {
        json!({"rules": pump_rules(),
               "checks": [{"name": "protected-files", "passed": true}],
               "requirements": [
                   {"id": "SR-1", "result": results[0], "why": ["demo/pump/pump.h"]},
                   {"id": "SR-2", "result": results[1], "why": ["demo/pump/pump.h"]},
                   {"id": "SR-3", "result": results[2], "why": ["demo/pump/pump.h"]}],
               "world": {"verdict": world_verdict, "results": runs}})
    }

    fn eval(v: &Value) -> Verdict {
        evaluate(serde_json::to_string(v).unwrap().as_bytes())
    }

    fn safe() -> Value {
        input(["PASS", "PASS", "PASS"], vec![run(false, false), run(true, true)], "PASS")
    }

    #[test]
    fn all_evidence_green_passes() {
        let v = eval(&safe());
        assert_eq!(v.verdict, "PASS", "{:?}", v.reasons);
        assert_eq!(v.world.preexisting, 1);
        assert!(v.requirements.iter().all(|r| r.pass && r.affected));
    }

    #[test]
    fn sr1_bolus_limit_failure_blocks_and_links_h1() {
        let v = eval(&input(["FAIL", "PASS", "PASS"], vec![run(false, false)], "PASS"));
        assert_eq!(v.verdict, "BLOCKED");
        let sr1 = &v.requirements[0];
        assert!(!sr1.pass);
        assert_eq!(sr1.hazards[0].id, "H-1");
        assert!(sr1.reason.contains("H-1 Insulin overdose"));
        assert_eq!(v.reasons, vec!["SR-1 FAIL (Single bolus never exceeds 10 U; H-1)"]);
    }

    #[test]
    fn sr2_daily_limit_failure_blocks() {
        let v = eval(&input(["PASS", "FAIL", "PASS"], vec![run(false, false)], "PASS"));
        assert_eq!(v.verdict, "BLOCKED");
        assert!(!v.requirements[1].pass && v.requirements[1].hazards[0].id == "H-2");
    }

    #[test]
    fn sr3_low_bg_failure_blocks() {
        let v = eval(&input(["PASS", "PASS", "FAIL"], vec![run(false, false)], "PASS"));
        assert_eq!(v.verdict, "BLOCKED");
        assert!(!v.requirements[2].pass && v.requirements[2].hazards[0].id == "H-3");
    }

    #[test]
    fn missing_test_blocks() {
        let v = eval(&input(["NO TEST", "PASS", "PASS"], vec![run(false, false)], "PASS"));
        assert_eq!(v.verdict, "BLOCKED");
    }

    #[test]
    fn unaffected_requirement_is_reported_not_blocking() {
        let mut i = safe();
        i["requirements"].as_array_mut().unwrap().remove(2);
        let v = eval(&i);
        assert_eq!(v.verdict, "PASS");
        assert!(!v.requirements[2].affected && v.requirements[2].result == "NOT AFFECTED");
    }

    #[test]
    fn new_severe_hypo_blocks_preexisting_does_not() {
        let v = eval(&input(["PASS", "PASS", "PASS"], vec![run(true, false)], "BLOCKED"));
        assert_eq!(v.verdict, "BLOCKED");
        assert_eq!(v.world.new_exceedances, 1);
        assert!(!v.world.pass);
        let v = eval(&input(["PASS", "PASS", "PASS"], vec![run(true, true)], "PASS"));
        assert_eq!(v.verdict, "PASS");
    }

    #[test]
    fn world_model_flags_are_cross_checked() {
        let mut i = safe();
        i["world"]["results"][0]["new_hypo"] = json!(true); // new_hypo without hypo
        assert_eq!(eval(&i).verdict, "BLOCKED");
        let mut i = safe();
        i["world"]["verdict"] = json!("BLOCKED"); // reported verdict disagrees with its runs
        assert_eq!(eval(&i).verdict, "BLOCKED");
        let mut i = safe();
        i["world"]["results"] = json!([]);
        assert_eq!(eval(&i).verdict, "BLOCKED");
    }

    #[test]
    fn failed_check_blocks() {
        let mut i = safe();
        i["checks"][0]["passed"] = json!(false);
        let v = eval(&i);
        assert_eq!(v.reasons, vec!["check protected-files failed"]);
    }

    #[test]
    fn rule_table_must_trace_every_requirement_to_a_known_hazard() {
        let mut i = safe();
        i["rules"]["requirements"][1]["hazards"] = json!([]);
        i["rules"]["requirements"][2]["hazards"] = json!(["H-9"]);
        let v = eval(&i);
        assert_eq!(v.reasons, vec!["rule table: SR-2 links no hazard", "rule table: SR-3 links unknown hazard H-9"]);
    }

    #[test]
    fn unknown_or_duplicate_test_results_block() {
        let mut i = safe();
        i["requirements"].as_array_mut().unwrap().push(json!({"id": "SR-99", "result": "PASS"}));
        i["requirements"].as_array_mut().unwrap().push(json!({"id": "SR-1", "result": "PASS"}));
        let v = eval(&i);
        assert_eq!(v.verdict, "BLOCKED");
        assert_eq!(v.reasons.len(), 2);
    }

    #[test]
    fn malformed_input_blocks() {
        for bad in [&b""[..], b"{", b"null", b"{\"rules\": 3}", b"{\"rules\": {\"hazards\": []}}", &[0xff, 0xfe]] {
            let v = evaluate(bad);
            assert_eq!(v.verdict, "BLOCKED");
            assert!(v.reasons[0].starts_with("input rejected"));
        }
        assert_eq!(evaluate(&vec![b' '; MAX_INPUT_BYTES + 1]).verdict, "BLOCKED");
    }

    #[test]
    fn digest_covers_input_rules_and_verdict() {
        let a = eval(&safe());
        let b = eval(&input(["PASS", "PASS", "FAIL"], vec![run(false, false), run(true, true)], "PASS"));
        assert_eq!(a.digest.rules_sha256, b.digest.rules_sha256);
        assert_ne!(a.digest.input_sha256, b.digest.input_sha256);
        assert_ne!(a.digest.verdict_sha256, b.digest.verdict_sha256);
        assert_eq!(a.digest.input_sha256.len(), 64);
        let rules = serde_json::to_string(&pump_rules()).unwrap();
        assert_eq!(a.digest.rules_sha256, sha256_hex(rules.as_bytes()));
    }

    /// xorshift64: deterministic pseudo-random inputs without an extra crate.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
            xs[(self.next() % xs.len() as u64) as usize]
        }
        fn bit(&mut self) -> bool {
            self.next() & 1 == 1
        }
    }

    fn random_input(rng: &mut Rng) -> Value {
        let results = ["PASS", "PASS", "PASS", "FAIL", "NO TEST"];
        let mut reqs = Vec::new();
        for id in ["SR-1", "SR-2", "SR-3"] {
            if rng.next() % 4 != 0 {
                reqs.push(json!({"id": id, "result": rng.pick(&results), "why": ["demo/pump/pump.c"]}));
            }
        }
        let runs: Vec<Value> = (0..(rng.next() % 6))
            .map(|i| {
                let hypo = rng.next() % 5 == 0;
                let pre = hypo && rng.bit();
                json!({"scenario": "s", "patient": format!("p{i}"), "hypo": hypo, "new_hypo": hypo && !pre, "preexisting": pre})
            })
            .collect();
        let world_ok = runs.iter().all(|r| !r["new_hypo"].as_bool().unwrap());
        let honest = rng.next() % 10 > 0; // 1 in 10 reports a verdict its own runs contradict
        let verdict = if world_ok == honest { "PASS" } else { "BLOCKED" };
        json!({"rules": pump_rules(),
               "checks": [{"name": "protected-files", "passed": rng.next() % 8 != 0}],
               "requirements": reqs,
               "world": if rng.next() % 10 == 0 { Value::Null } else { json!({"verdict": verdict, "results": runs}) }})
    }

    #[test]
    fn property_no_unsafe_evidence_ever_passes() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let (mut passes, mut blocks) = (0, 0);
        for _ in 0..20_000 {
            let i = random_input(&mut rng);
            let v = eval(&i);
            let sr1_failed = i["requirements"].as_array().unwrap().iter().any(|r| r["id"] == "SR-1" && r["result"] != "PASS");
            let any_failed = i["requirements"].as_array().unwrap().iter().any(|r| r["result"] != "PASS");
            let new_harm = i["world"]["results"].as_array().is_some_and(|rs| rs.iter().any(|r| r["new_hypo"] == true));
            let check_failed = i["checks"][0]["passed"] == false;
            if v.verdict == "PASS" {
                passes += 1;
                // A raised single-bolus limit (> 10 U) fails SR-1's test; such evidence never yields PASS.
                assert!(!sr1_failed, "SR-1 failure passed: {i}");
                assert!(!any_failed && !new_harm && !check_failed, "unsafe evidence passed: {i}");
                assert!(v.reasons.is_empty() && v.requirements.iter().all(|r| r.pass));
            } else {
                blocks += 1;
                assert!(!v.reasons.is_empty());
            }
            assert_eq!(v, eval(&i), "verdict must be deterministic");
        }
        assert!(passes > 1000 && blocks > 1000, "generator must exercise both verdicts: {passes} / {blocks}");
    }

    #[test]
    fn property_tampered_evidence_never_panics_and_changes_the_digest() {
        let mut rng = Rng(42);
        let base = serde_json::to_vec(&safe()).unwrap();
        let original = evaluate(&base).digest;
        for _ in 0..20_000 {
            let mut bytes = base.clone();
            let at = (rng.next() % bytes.len() as u64) as usize;
            bytes[at] = (rng.next() & 0xff) as u8;
            let v = evaluate(&bytes);
            if bytes != base {
                assert_ne!(v.digest.input_sha256, original.input_sha256);
                assert_ne!(v.digest.verdict_sha256, original.verdict_sha256);
            }
        }
    }
}
