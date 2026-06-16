"""
slash - slash command patterns (register / sync / choices / autocomplete / group / ephemeral+defer).

WHAT : Collection of app_commands slash-command authoring and sync patterns.
DEPS : discord.py>=2.6
PERMS: applications.commands OAuth2 scope (include when re-inviting the bot)
USAGE: tree = app_commands.CommandTree(client)
       @tree.command(name="hello", description="Say hello")
       async def hello(interaction):
           if not is_user(interaction, ALLOWED_USER_ID): ...
           await interaction.response.send_message("hi", ephemeral=True)
       # in on_ready:  await sync_guild(tree, GUILD_ID)   # guild sync is instant; global sync takes ~1 hour
SAFETY: Call is_user() on the first line of every callback to verify the allowed user.
        For slow operations, defer() first, then use followup.

DEMO: python harness/slash/slash.py   (prints pattern summary)

choices / autocomplete / group patterns (copy and adapt):

   @tree.command(name="effort")
   @app_commands.describe(level="Reasoning depth")
   @app_commands.choices(level=[app_commands.Choice(name="low", value="low"),
                                app_commands.Choice(name="high", value="high")])
   async def effort(interaction, level: app_commands.Choice[str]): ...

   @tree.command(name="pick")
   async def pick(interaction, item: str): ...
   @pick.autocomplete("item")
   async def pick_ac(interaction, current: str):
       return [app_commands.Choice(name=x, value=x) for x in POOL if current.lower() in x.lower()][:25]

   grp = app_commands.Group(name="db", description="DB")
   @grp.command(name="get")
   async def db_get(interaction, key: str): ...
   tree.add_command(grp)     # /db get

   # slow operation:  await interaction.response.defer(ephemeral=True);  ... ;  await interaction.followup.send(...)
"""

import discord
from discord import app_commands


def is_user(interaction: discord.Interaction, allowed_user_id: int) -> bool:
    """Return True if the interaction user matches the allowed user ID."""
    return interaction.user.id == allowed_user_id


async def sync_guild(tree: app_commands.CommandTree, guild_id: int) -> list:
    """Sync commands to a specific guild (takes effect immediately). For global sync use tree.sync()."""
    return await tree.sync(guild=discord.Object(id=guild_id))


if __name__ == "__main__":
    assert hasattr(app_commands, "CommandTree") and hasattr(app_commands, "Choice")
    print("slash: pattern file. is_user()/sync_guild() helpers + choices/autocomplete/group examples in the docstring above.")
