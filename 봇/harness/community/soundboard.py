"""
soundboard - guild soundboard utilities  [niche / non-mainstream]

WHAT  : List guild soundboard sounds (playback requires a voice connection;
        support varies by discord.py version).
DEPS  : discord.py>=2.6
PERMS : Use Soundboard
USAGE : sounds = list_sounds(guild)
SAFETY: Check discord.py version for soundboard support before using.
DEMO  : python harness/community/soundboard.py  (offline info)
"""


def list_sounds(guild):
    return list(getattr(guild, "soundboard_sounds", []) or [])


if __name__ == "__main__":
    print("soundboard: list_sounds(guild) -- support varies by discord.py version")
