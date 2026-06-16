"""
installctx - user-install and DM context configuration.

WHAT : Configures a slash command so it can be installed and used not only in
       guilds but also by individual users (DMs and other servers).
DEPS : discord.py>=2.6
PERMS: applications.commands; User Install must be enabled in the Developer Portal.
USAGE: @tree.command(name="note", description="Take a note")
       @app_commands.allowed_installs(guilds=True, users=True)
       @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
       async def note(interaction): ...
SAFETY: In DM contexts, interaction.guild may be None. Branch accordingly.
DEMO  : python harness/slash/installctx.py  (checks whether the decorators are available)
"""

from discord import app_commands


if __name__ == "__main__":
    ok = hasattr(app_commands, "allowed_installs") and hasattr(app_commands, "allowed_contexts")
    print("installctx: allowed_installs/allowed_contexts available =", ok)
    print("Usage: attach both decorators to a slash command to enable user-install and DM context.")
