"""
imagesend - Send and in-place replace chart/image attachments.

WHAT  : Send an image (file path or BytesIO) to a channel, and replace
        the attachment on an existing message with a new one.
DEPS  : discord.py>=2.6
PERMS : Send Messages, Attach Files
USAGE : msg = await send_image(CHANNEL, "chart.png")   # path or BytesIO
        await replace_image(msg, new_bytesio, "chart.png")
SAFETY: -
DEMO  : python harness/media/imagesend.py  (prints usage example)
"""

from typing import Optional, Union
import io

import discord


async def send_image(
    channel: "discord.abc.Messageable",
    source: Union[str, io.IOBase],
    filename: str = "image.png",
    content: Optional[str] = None,
) -> discord.Message:
    return await channel.send(content=content, file=discord.File(source, filename))


async def replace_image(
    message: discord.Message,
    source: Union[str, io.IOBase],
    filename: str = "image.png",
) -> bool:
    try:
        await message.edit(attachments=[discord.File(source, filename)])
        return True
    except Exception:
        return False


if __name__ == "__main__":
    print("Usage: msg = await send_image(CHANNEL, 'chart.png');  await replace_image(msg, new, 'chart.png')")
