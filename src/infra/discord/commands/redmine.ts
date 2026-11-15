import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type SlashCommandIntegerOption,
} from 'discord.js';
import type { RedmineService } from '~/core/services';
import { channelMention, discordTime, type Issue } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand, deferred } from '../define';
import type {
  ComponentHandler,
  CommandInteraction,
  Feature,
  SlashCommand,
} from '../module';
import { respond } from '../router';

const issueOption = (o: SlashCommandIntegerOption) =>
  o
    .setName('issue')
    .setDescription('Issue number')
    .setRequired(true)
    .setMinValue(1);

const data = new SlashCommandBuilder()
  .setName('redmine')
  .setDescription('Redmine projects and issues')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName('projects').setDescription('Projects you can see'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('issues')
      .setDescription('List issues')
      .addStringOption((o) =>
        o.setName('project').setDescription('Project identifier'),
      )
      .addBooleanOption((o) =>
        o.setName('mine').setDescription('Only issues assigned to me'),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Status filter')
          .addChoices(
            { name: 'open', value: 'open' },
            { name: 'closed', value: 'closed' },
            { name: 'all', value: '*' },
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('issue')
      .setDescription('A single issue')
      .addSubcommand((sub) =>
        sub
          .setName('view')
          .setDescription('Show an issue')
          .addIntegerOption(issueOption),
      )
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Create an issue')
          .addStringOption((o) =>
            o
              .setName('project')
              .setDescription('Project identifier')
              .setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName('subject')
              .setDescription('Subject')
              .setRequired(true)
              .setMaxLength(255),
          )
          .addStringOption((o) =>
            o
              .setName('description')
              .setDescription('Description')
              .setMaxLength(4000),
          )
          .addBooleanOption((o) =>
            o.setName('assign_to_me').setDescription('Assign it to me'),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('update')
          .setDescription('Change status or add notes')
          .addIntegerOption(issueOption)
          .addIntegerOption((o) =>
            o
              .setName('status')
              .setDescription('New status')
              .setAutocomplete(true),
          )
          .addStringOption((o) =>
            o.setName('notes').setDescription('Notes').setMaxLength(4000),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('assign')
          .setDescription('Assign an issue')
          .addIntegerOption(issueOption)
          .addUserOption((o) =>
            o.setName('member').setDescription('Linked member (default: you)'),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('comment')
          .setDescription('Comment on an issue')
          .addIntegerOption(issueOption)
          .addStringOption((o) =>
            o
              .setName('text')
              .setDescription('Comment')
              .setRequired(true)
              .setMaxLength(4000),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remind')
          .setDescription('DM me before the due date')
          .addIntegerOption(issueOption)
          .addIntegerOption((o) =>
            o
              .setName('days_before')
              .setDescription('Days before (default 1)')
              .setMinValue(0)
              .setMaxValue(30),
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('link')
      .setDescription('Link your Redmine account with your API key'),
  )
  .addSubcommand((sub) =>
    sub.setName('unlink').setDescription('Remove your stored Redmine key'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('subscribe')
      .setDescription('Post project updates in a channel')
      .addStringOption((o) =>
        o
          .setName('project')
          .setDescription('Project identifier')
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unsubscribe')
      .setDescription('Stop project updates in a channel')
      .addStringOption((o) =>
        o
          .setName('project')
          .setDescription('Project identifier')
          .setRequired(true),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

function issueLine(baseUrl: string, issue: Issue): string {
  const assignee = issue.assigned_to ? ` · ${issue.assigned_to.name}` : '';

  return `[#${issue.id}](<${baseUrl}issues/${issue.id}>) **${issue.subject}** — ${issue.status.name}${assignee}`;
}

function issueEmbed(baseUrl: string, issue: Issue): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`#${issue.id} ${issue.subject}`.slice(0, 256))
    .setURL(`${baseUrl}issues/${issue.id}`)
    .setDescription((issue.description ?? '').slice(0, 1500) || null)
    .addFields(
      { name: 'Project', value: issue.project.name, inline: true },
      { name: 'Status', value: issue.status.name, inline: true },
      { name: 'Priority', value: issue.priority.name, inline: true },
      { name: 'Assignee', value: issue.assigned_to?.name ?? '—', inline: true },
      { name: 'Due', value: issue.due_date ?? '—', inline: true },
    );
}

type Handler = (interaction: CommandInteraction) => Promise<void>;

export function redmineCommands(
  redmine: RedmineService,
  baseUrl: string,
): Feature {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const actorOf = (interaction: CommandInteraction) =>
    toActor(interaction.member);
  const channelOf = (interaction: CommandInteraction) =>
    interaction.options.getChannel('channel')?.id ?? interaction.channelId;

  const handlers: Record<string, Handler> = {
    projects: async (interaction) => {
      const { projects, total } = await redmine.projects(actorOf(interaction));
      const lines = projects.map((p) => `"${p.identifier}" ${p.name}`);
      const more =
        total > projects.length ? [`…and ${total - projects.length} more`] : [];

      await respond(
        interaction,
        [...lines, ...more].join('\n') || 'No projects.',
      );
    },
    issues: async (interaction) => {
      const status = interaction.options.getString('status');
      const project = interaction.options.getString('project');
      const { issues, total } = await redmine.issues(actorOf(interaction), {
        ...(project !== null && { projectId: project }),
        assignedToMe: interaction.options.getBoolean('mine') ?? false,
        status: status === 'closed' || status === '*' ? status : 'open',
      });
      const lines = issues.map((issue) => issueLine(root, issue));

      await respond(
        interaction,
        lines.length === 0
          ? 'No issues.'
          : `${lines.join('\n')}\n${issues.length} of ${total}`.slice(0, 2000),
      );
    },
    'issue view': async (interaction) => {
      const issue = await redmine.issue(
        actorOf(interaction),
        interaction.options.getInteger('issue', true),
      );

      await respond(interaction, { embeds: [issueEmbed(root, issue)] });
    },
    'issue create': async (interaction) => {
      const description = interaction.options.getString('description');
      const issue = await redmine.createIssue(actorOf(interaction), {
        project: interaction.options.getString('project', true),
        subject: interaction.options.getString('subject', true),
        ...(description !== null && { description }),
        assignToMe: interaction.options.getBoolean('assign_to_me') ?? false,
      });

      await respond(interaction, `Created ${issueLine(root, issue)}`);
    },
    'issue update': async (interaction) => {
      const statusId = interaction.options.getInteger('status');
      const notes = interaction.options.getString('notes');
      const id = interaction.options.getInteger('issue', true);

      await redmine.updateIssue(actorOf(interaction), id, {
        ...(statusId !== null && { statusId }),
        ...(notes !== null && { notes }),
      });
      await respond(interaction, `Updated #${id}.`);
    },
    'issue assign': async (interaction) => {
      const id = interaction.options.getInteger('issue', true);
      const member = interaction.options.getUser('member');

      await redmine.assign(
        actorOf(interaction),
        id,
        ...(member ? [member.id] : []),
      );
      await respond(interaction, `Assigned #${id}.`);
    },
    'issue comment': async (interaction) => {
      const id = interaction.options.getInteger('issue', true);

      await redmine.comment(
        actorOf(interaction),
        id,
        interaction.options.getString('text', true),
      );
      await respond(interaction, `Commented on #${id}.`);
    },
    'issue remind': async (interaction) => {
      const reminder = await redmine.remind(
        actorOf(interaction),
        interaction.options.getInteger('issue', true),
        interaction.options.getInteger('days_before') ?? 1,
      );

      await respond(
        interaction,
        `I will DM you ${discordTime(reminder.runAt, 'R')} (reminder #${reminder.id}).`,
      );
    },
    unlink: async (interaction) => {
      const removed = await redmine.unlink(actorOf(interaction));

      await respond(
        interaction,
        removed ? 'Your Redmine key is deleted.' : 'You had no linked account.',
      );
    },
    subscribe: async (interaction) => {
      const channelId = channelOf(interaction);
      const { project, added } = await redmine.subscribe(
        actorOf(interaction),
        channelId,
        interaction.options.getString('project', true),
      );

      await respond(
        interaction,
        added
          ? `${channelMention(channelId)} now gets updates for ${project.name}. Everyone who can read the channel will see them.`
          : 'That channel is already subscribed.',
      );
    },
    unsubscribe: async (interaction) => {
      const channelId = channelOf(interaction);
      const { project, removed } = await redmine.unsubscribe(
        actorOf(interaction),
        channelId,
        interaction.options.getString('project', true),
      );

      await respond(
        interaction,
        removed
          ? `Unsubscribed ${channelMention(channelId)} from ${project.name}.`
          : 'No such subscription.',
      );
    },
  };

  const link: Handler = async (interaction) => {
    const key = new TextInputBuilder()
      .setCustomId('key')
      .setStyle(TextInputStyle.Short)
      .setMinLength(20)
      .setMaxLength(100);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('redmine:link')
        .setTitle('Link Redmine')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('API key')
            .setDescription(
              'Redmine → My account → API access key. Stored encrypted.',
            )
            .setTextInputComponent(key),
        ),
    );
  };

  const linkModal: ComponentHandler = {
    prefix: 'redmine:link',
    execute: async (interaction) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const user = await redmine.link(
        toActor(interaction.member),
        interaction.fields.getTextInputValue('key'),
      );

      await respond(interaction, `Linked to Redmine user **${user.login}**.`);
    },
  };

  const command: SlashCommand = {
    data: data.toJSON(),
    execute: bySubcommand({
      link,
      ...Object.fromEntries(
        Object.entries(handlers).map(([path, handler]) => [
          path,
          deferred(handler),
        ]),
      ),
    }),
    autocomplete: async (interaction) => {
      const statuses = await redmine.statuses(toActor(interaction.member));

      await interaction.respond(
        statuses.slice(0, 25).map((s) => ({ name: s.name, value: s.id })),
      );
    },
  };

  return {
    name: 'redmine',
    permissions: [
      {
        id: 'redmine:issue:create',
        description: 'Create Redmine issues (Redmine permissions still apply)',
      },
      {
        id: 'redmine:issue:update',
        description: 'Update and comment on Redmine issues',
      },
      { id: 'redmine:issue:assign', description: 'Assign Redmine issues' },
      {
        id: 'redmine:subscription:manage',
        description: 'Subscribe channels to Redmine projects',
      },
    ],
    commands: [command],
    components: [linkModal],
    start: () => redmine.start(),
  };
}
