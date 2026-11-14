//! certus-gate: verdict JSON on stdout for gate evidence JSON on stdin. Exit 0 = PASS, 1 = BLOCKED, 2 = I/O error.
#![forbid(unsafe_code)]

use std::io::{Read, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut input = Vec::new();
    let limit = u64::try_from(certus_gate::MAX_INPUT_BYTES).unwrap_or(u64::MAX).saturating_add(1);
    if std::io::stdin().take(limit).read_to_end(&mut input).is_err() {
        return ExitCode::from(2);
    }
    let verdict = certus_gate::evaluate(&input);
    let Ok(out) = serde_json::to_string(&verdict) else {
        return ExitCode::from(2);
    };
    if writeln!(std::io::stdout(), "{out}").is_err() {
        return ExitCode::from(2);
    }
    ExitCode::from(if verdict.verdict == "PASS" { 0 } else { 1 })
}
