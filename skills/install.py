"""
v5 study-bot global skill installer.

1회 실행으로 ~/.claude/skills/v5-study-bot/SKILL.md 를 생성한다.
이 스크립트의 위치에서 APP 절대경로를 자동 감지해 SKILL.md 의 <APP> 플레이스홀더를 치환한다.
커밋에 포함되지 않는 절대경로 산출물을 생성하는 유일한 지점이다.

실행 방법:
    python "<APP>/skills/install.py"
"""

import sys
import pathlib
import shutil


SKILL_NAME = "v5-study-bot"
PLACEHOLDER = "<APP>"


def main():
    try:
        # 이 파일의 위치(skills/) 기준으로 APP 루트를 역산한다.
        skills_dir = pathlib.Path(__file__).resolve().parent
        app_root = skills_dir.parent

        # APP 루트가 실제 존재하는지 확인한다.
        if not app_root.is_dir():
            print(f"오류: APP 루트를 찾을 수 없습니다: {app_root}", file=sys.stderr)
            sys.exit(1)

        # SKILL.md 템플릿을 읽는다.
        template_path = skills_dir / "SKILL.md"
        if not template_path.is_file():
            print(f"오류: 템플릿을 찾을 수 없습니다: {template_path}", file=sys.stderr)
            sys.exit(1)

        template_text = template_path.read_text(encoding="utf-8")

        # <APP> 플레이스홀더를 실제 절대경로로 치환한다.
        app_str = str(app_root)
        if PLACEHOLDER not in template_text:
            print("경고: 템플릿에 <APP> 플레이스홀더가 없습니다. 파일을 확인하세요.", file=sys.stderr)
        skill_text = template_text.replace(PLACEHOLDER, app_str)

        # ~/.claude/skills/<name>/ 디렉터리를 만든다.
        dest_dir = pathlib.Path.home() / ".claude" / "skills" / SKILL_NAME
        dest_dir.mkdir(parents=True, exist_ok=True)

        dest_path = dest_dir / "SKILL.md"

        # 기존 파일이 있으면 덮어쓴다(재실행 안전).
        dest_path.write_text(skill_text, encoding="utf-8")

        print(f"설치 완료: {dest_path}")
        print(f"APP = {app_str}")
        print()
        print("다음 단계:")
        print(f"  1. {app_root / '.env.example'} 을 복사해 .env 를 만든다.")
        print("  2. .env 에 필수 4키(DISCORD_BOT_TOKEN·GUILD_ID·CHANNEL_ID·ALLOWED_USER_ID)를 채운다.")
        print(f"  3. 과목 폴더에서 python \"{app_root / '봇' / 'main.py'}\" 를 실행한다.")

    except Exception as exc:
        print(f"설치 실패: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
