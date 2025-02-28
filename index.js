'use strict';

require("dotenv").config({ path: "./.env" });

const { Client, Events, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
});

const roleMap = {
    '1️⃣': process.env.TARKVARA_ROLE_ID,
    '2️⃣': process.env.HELPDESK_ROLE_ID,
    '3️⃣': process.env.KULTUUR_ROLE_ID,
    // '4️⃣': process.env.TURUNDUS_ROLE_ID
};

client.once(Events.ClientReady, async c => {
    console.log(`Logged in as ${c.user.tag}`);

    const roleMessage = "Valige endale rolli:\n1 - Tarkvara\n2 - Helpdesk\n3 - Kultuur";
    await createMessageWithReactions(roleMessage);
});

async function createMessageWithReactions(roleMessage) {
    const channel = await client.channels.fetch(process.env.ROLE_SELECTION_CHANNEL_ID); // make sure no one can send messages in this channel
    const messages = await channel.messages.fetch({ limit: 5 }); // if more than 5 messages in channel, increase limit,
                                                                // if not planning to send any other messages in the channel
                                                                // can set limit to 1
    const existingMessage = messages.find(msg => msg.content === roleMessage);

    if (!existingMessage) {
        const sentMessage = await channel.send(roleMessage);

        await sentMessage.react('1️⃣');
        await sentMessage.react('2️⃣');
        await sentMessage.react('3️⃣'); // kultuuritiim (turundus + üritused)
        // await sentMessage.react('4️⃣'); // was turundus/uritused 

        console.log("Message sent.");
    } else {
        console.log("Message already exists.");
    }
}

async function handleReaction(reaction, user, addRole) {
    if (reaction.message.partial){
        await reaction.message.fetch();
    }
    if (reaction.partial) {
        await reaction.fetch();
    }
    if (user.bot) {
        return;
    }

    const roleId = roleMap[reaction.emoji.name];

    if (!roleId) {
        return;
    }

    const member = await reaction.message.guild.members.fetch(user.id);
    if (addRole) {
        await member.roles.add(roleId);
        const role = await reaction.message.guild.roles.fetch(roleId);
        console.log(`Assigned role ${role.name} to user ${user.tag}`);
    } else {
        await member.roles.remove(roleId);
        const role = await reaction.message.guild.roles.fetch(roleId);
        console.log(`Removed role ${role.name} from user ${user.tag}`);
    }
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    await handleReaction(reaction, user, true);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    await handleReaction(reaction, user, false);
});

// Welcome message (not needer rn)

// client.on(Events.GuildMemberAdd, async (member) => {
//     try {
//         const welcomeChannel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);

//         if (!welcomeChannel) {
//             return console.error("Welcome channel not found!");
//         }

//         const highlight = `<@${member.user.id}>`;

//         const embed = new EmbedBuilder()
//             .setTitle("Welcome to the Server!")
//             .setDescription(`Hei <@${member.user.id}>! Valige endale sobiva rolli siin: <#${process.env.ROLE_SELECTION_CHANNEL_ID}>`)
//             .setColor("#FFAC1C");

//         await welcomeChannel.send({ content: highlight, embeds: [embed] });
//     } catch (error) {
//         console.error("Error sending welcome message:", error);
//     }
// });

client.login(process.env.DISCORD_TOKEN);
