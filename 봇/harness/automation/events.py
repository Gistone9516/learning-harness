"""
events - Catalog of useful event hook patterns.

WHAT  : A collection of common discord event hook examples (join/leave/voice/
        message delete and edit/reactions/threads, etc.).
DEPS  : discord.py>=2.6
PERMS : Enable the intents matching each event (members, message_content,
        voice_states, etc.) in the Discord Developer Portal.
USAGE : Copy a pattern below and register it on your client with @client.event.
        Turn on the required intents in your Intents object.
SAFETY: members and message_content are privileged intents and must be
        enabled in the Developer Portal before use.
INTENTS:
   members         -- on_member_join / on_member_remove (privileged)
   message_content -- read message body (privileged)
   voice_states    -- on_voice_state_update
DEMO  : python harness/automation/events.py  (prints usage hint)

Patterns (copy and register on your client):
   @client.event
   async def on_member_join(member): ...
   async def on_member_remove(member): ...
   async def on_message_delete(message): ...
   async def on_message_edit(before, after): ...
   async def on_raw_reaction_add(payload): ...
   async def on_voice_state_update(member, before, after): ...
   async def on_guild_join(guild): ...
   async def on_thread_create(thread): ...

Intents setup example:
   intents = discord.Intents.default()
   intents.members = True          # on_member_join/remove (privileged)
   intents.message_content = True  # read message body (privileged)
   intents.voice_states = True     # on_voice_state_update
"""

if __name__ == "__main__":
    print("events: Event hook pattern catalog. Register the hooks you need on your client and enable the matching intents.")
