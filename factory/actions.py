"""External actions through Composio: the factory files GitHub issues and posts Slack updates as an agent.

Needs COMPOSIO_API_KEY. One-time human step: in the Composio dashboard create a GitHub auth config (and Slack if
wanted), put the ids in COMPOSIO_GITHUB_AUTH_CONFIG / COMPOSIO_SLACK_AUTH_CONFIG, then run
  .venv/bin/python factory/actions.py connect      # prints links; open them and click Authorize
Optional: SLACK_CHANNEL (e.g. #factory). Only a fixed allow-list of tools is ever executed.
"""
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER = os.environ.get("COMPOSIO_USER_ID", "certus-factory")
FLAG = os.path.join(ROOT, ".runs", "hazard_issue_filed")


def _client():
    from composio import Composio
    return Composio(api_key=os.environ["COMPOSIO_API_KEY"], toolkit_versions={"github": "latest", "slack": "latest"})


def _repo():
    url = subprocess.run(["git", "-C", ROOT, "remote", "get-url", "origin"], capture_output=True, text=True).stdout
    m = re.search(r"github\.com[:/]([^/]+)/([^/.\s]+)", url)
    return m.group(1), m.group(2)


def _exec(c, slug, args):
    return c.tools.execute(slug, user_id=USER, arguments=args, dangerously_skip_version_check=True)


def after_run(wo, intent, passed, summary):
    """Returns a one-line description of what was done, or '' when Composio is not configured."""
    if not os.environ.get("COMPOSIO_API_KEY"):
        return ""
    done = []
    try:
        c = _client()
        owner, repo = _repo()
        if summary.get("preexisting") and not os.path.exists(FLAG):
            _exec(c, "GITHUB_CREATE_AN_ISSUE", {
                "owner": owner, "repo": repo,
                "title": "World model: severe hypoglycemia risk on main (decimal slip, insulin-sensitive patients)",
                "body": f"Found by the Certus Factory world model during {wo} ({intent}).\n\n{summary['headline']}\n\n"
                        "Proposed SR-6: cap a single bolus relative to the patient's configured carb ratio."})
            open(FLAG, "w").write(wo)
            done.append("filed GitHub issue for pre-existing hazard")
        if os.environ.get("SLACK_CHANNEL"):
            _exec(c, "SLACK_SEND_MESSAGE", {"channel": os.environ["SLACK_CHANNEL"],
                                            "markdown_text": f"*{wo}* {'APPROVED' if passed else 'BLOCKED'}: {intent}\n{summary['headline']}"})
            done.append(f"posted to Slack {os.environ['SLACK_CHANNEL']}")
    except Exception as e:
        return f"Composio action failed: {str(e)[:120]}"
    return "Composio: " + "; ".join(done) if done else ""


if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["connect"]:
        c = _client()
        for var in ("COMPOSIO_GITHUB_AUTH_CONFIG", "COMPOSIO_SLACK_AUTH_CONFIG"):
            if os.environ.get(var):
                req = c.connected_accounts.link(user_id=USER, auth_config_id=os.environ[var])
                print(f"{var}: open {req.redirect_url}")
