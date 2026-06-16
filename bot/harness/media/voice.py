"""
voice - voice channel connection and audio playback.

WHAT  : Connect to a voice channel and play audio files or streams (basic music-bot functionality).
DEPS  : discord.py>=2.6, PyNaCl, system ffmpeg
PERMS : Connect, Speak
INTENTS: voice_states
USAGE : vc = await join(VOICE_CHANNEL); await play_file(vc, "song.mp3"); ... ; await leave(vc)
SAFETY: Fails if PyNaCl or ffmpeg is not installed. Only one voice connection per guild.
DEMO  : python harness/media/voice.py  (checks whether dependencies are available)
"""

import shutil
from typing import Callable, Optional

import discord


async def join(voice_channel: discord.VoiceChannel) -> discord.VoiceClient:
    return await voice_channel.connect()


async def play_file(
    voice_client: discord.VoiceClient,
    path: str,
    after: Optional[Callable[[Optional[Exception]], None]] = None,
) -> discord.VoiceClient:
    voice_client.play(discord.FFmpegPCMAudio(path), after=after)
    return voice_client


async def leave(voice_client: discord.VoiceClient) -> None:
    try:
        await voice_client.disconnect()
    except Exception:
        pass


if __name__ == "__main__":
    try:
        import nacl  # noqa: F401
        have_nacl = True
    except Exception:
        have_nacl = False
    print("voice: PyNaCl =", have_nacl, "| ffmpeg =", bool(shutil.which("ffmpeg")))
    print("usage: vc = await join(VOICE_CH);  await play_file(vc, 'song.mp3');  await leave(vc)")
