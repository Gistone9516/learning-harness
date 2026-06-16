"""
scheduledevents - Guild scheduled events.  [non-mainstream]

WHAT : Create and retrieve guild scheduled events.
DEPS : discord.py>=2.6
PERMS: Manage Events
USAGE: ev = await create_external(guild, "Launch", start, end, location="Online")
       events = guild.scheduled_events
SAFETY: Pass timezone-aware datetime objects. Verify argument signatures against your
        discord.py version before upgrading.
DEMO  : python harness/community/scheduledevents.py
"""

import datetime

import discord


async def create_external(
    guild: "discord.Guild",
    name: str,
    start_time: datetime.datetime,
    end_time: datetime.datetime,
    location: str = "Online",
    description: str = "",
) -> "discord.ScheduledEvent":
    """Create an external scheduled event on the given guild."""
    return await guild.create_scheduled_event(
        name=name, start_time=start_time, end_time=end_time,
        entity_type=discord.EntityType.external,
        privacy_level=discord.PrivacyLevel.guild_only,
        location=location, description=description,
    )


if __name__ == "__main__":
    print("scheduledevents: await create_external(guild, 'name', start, end, location='Online')")
