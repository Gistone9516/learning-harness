"""
learning-harness global skill installer.

A single run creates ~/.claude/skills/learning-harness/SKILL.md.
The script auto-detects the APP absolute path from its own location
and substitutes the <APP> placeholder in SKILL.md.
This is the only place that produces an absolute-path artifact not tracked by git.

Usage:
    python "<APP>/skills/install.py"   (or run the kit bootstrap: python tools/setup.py)
"""

import sys
import pathlib
import shutil


SKILL_NAME = "learning-harness"
PLACEHOLDER = "<APP>"


def main():
    try:
        # Derive the APP root from this file's location (skills/).
        skills_dir = pathlib.Path(__file__).resolve().parent
        app_root = skills_dir.parent

        # Verify the APP root actually exists.
        if not app_root.is_dir():
            print(f"Error: APP root not found: {app_root}", file=sys.stderr)
            sys.exit(1)

        # Read the SKILL.md template.
        template_path = skills_dir / "SKILL.md"
        if not template_path.is_file():
            print(f"Error: template not found: {template_path}", file=sys.stderr)
            sys.exit(1)

        template_text = template_path.read_text(encoding="utf-8")

        # Replace the <APP> placeholder with the real absolute path.
        app_str = str(app_root)
        if PLACEHOLDER not in template_text:
            print("Warning: template has no <APP> placeholder. Check the file.", file=sys.stderr)
        skill_text = template_text.replace(PLACEHOLDER, app_str)

        # Create the ~/.claude/skills/<name>/ directory.
        dest_dir = pathlib.Path.home() / ".claude" / "skills" / SKILL_NAME
        dest_dir.mkdir(parents=True, exist_ok=True)

        dest_path = dest_dir / "SKILL.md"

        # Overwrite any existing file (safe to re-run).
        dest_path.write_text(skill_text, encoding="utf-8")

        print(f"Install complete: {dest_path}")
        print(f"APP = {app_str}")
        print()
        print("Next steps:")
        print(f"  1. Copy {app_root / '.env.example'} to .env.")
        print("  2. Fill in the 4 required keys (DISCORD_BOT_TOKEN, GUILD_ID, CHANNEL_ID, ALLOWED_USER_ID) in .env.")
        print(f"  3. Run python \"{app_root / 'bot' / 'main.py'}\" from the subject folder.")

    except Exception as exc:
        print(f"Install failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
