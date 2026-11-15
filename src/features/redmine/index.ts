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
import { DateTime } from 'luxon';
import { respond } from '../../core/discord/router.js';
import { bySubcommand, deferred } from '../../core/define.js';
import type { Config } from '../../core/config.js';
import type {
  AppContext,
  CommandInteraction,
  ComponentHandler,
  Feature,
  SlashCommand,
} from '../../core/feature.js';
import { getGuildTimezone } from '../../core/guild-settings.js';
import {
  RedmineClient,
  RedmineError,
  type RedmineIssue,
  type RedmineUser,
} from '../../integrations/redmine/client.js';
import { createSecretBox, type SecretBox } from '../../shared/crypto.js';
import { UserError } from '../../shared/errors.js';
import { createReminder } from '../reminders/index.js';
import { createNotificationJobs } from './notifications.js';
import {
  addSubscription,
  deleteLink,
  getLink,
  removeSubscription,
  saveLink,
} from './service.js';

type Handler = (
  interaction: CommandInteraction,
  ctx: AppContext,
) => Promise<void>;

/** Redmine failures become user-facing messages; nothing about keys leaks. */
function withRedmineErrors(handler: Handler): Handler {
  return async (interaction, ctx) => {
    try {
      await handler(interaction, ctx);
    } catch (error) {
      if (error instanceof RedmineError) {
        ctx.log.warn(
          { kind: error.kind, userId: interaction.user.id },
          'Redmine request failed',
        );
        throw new UserError(error.message);
      }
      throw error;
    }
  };
}

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

function issueLine(baseUrl: string, issue: RedmineIssue): string {
  const assignee = issue.assigned_to ? ` · ${issue.assigned_to.name}` : '';
  return `[#${issue.id}](<${baseUrl}issues/${issue.id}>) **${issue.subject}** — ${issue.status.name}${assignee}`;
}

function issueEmbed(baseUrl: string, issue: RedmineIssue): EmbedBuilder {
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

/**
 * Discord-side permission is necessary but never sufficient: every request
 * below runs with the member's own Redmine key, so Redmine still decides.
 */
export function createRedmineFeature(config: Config): Feature | undefined {
  const base = config.REDMINE_BASE_URL;
  if (base === undefined) {
    return undefined;
  }
  if (config.CREDENTIAL_ENCRYPTION_KEY === undefined) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is required when REDMINE_BASE_URL is set',
    );
  }
  const baseUrl = base.endsWith('/') ? base : `${base}/`;
  const box: SecretBox = createSecretBox(config.CREDENTIAL_ENCRYPTION_KEY);
  const service =
    config.REDMINE_API_KEY === undefined
      ? undefined
      : new RedmineClient(baseUrl, config.REDMINE_API_KEY);
  const notifications = service && createNotificationJobs(service, baseUrl);

  async function clientFor(
    ctx: AppContext,
    userId: string,
  ): Promise<{ client: RedmineClient; redmineUserId: number }> {
    const link = await getLink(ctx.db, userId);
    if (!link) {
      throw new UserError(
        'Link your Redmine account first with `/redmine link`.',
      );
    }
    return {
      client: new RedmineClient(baseUrl, box.decrypt(link.encryptedApiKey)),
      redmineUserId: link.redmineUserId,
    };
  }

  const requireService = (): RedmineClient => {
    if (!service) {
      throw new UserError(
        'Redmine notifications are not configured (REDMINE_API_KEY).',
      );
    }
    return service;
  };

  const subscription =
    (action: 'subscribe' | 'unsubscribe'): Handler =>
    async (interaction, ctx) => {
      const channelId =
        interaction.options.getChannel('channel')?.id ?? interaction.channelId;
      // The project must be visible to the member and to the service account.
      const { client } = await clientFor(ctx, interaction.user.id);
      const identifier = interaction.options.getString('project', true);
      const { projects } = await client.listProjects(0, 100);
      const project = projects.find(
        (p) => p.identifier === identifier || String(p.id) === identifier,
      );
      if (!project) {
        throw new UserError(
          `Project "${identifier}" not found among your projects.`,
        );
      }
      if (action === 'unsubscribe') {
        const removed = await removeSubscription(
          ctx.db,
          interaction.guildId,
          channelId,
          project.id,
        );
        await respond(
          interaction,
          removed
            ? `Unsubscribed <#${channelId}> from ${project.name}.`
            : 'No such subscription.',
        );
        return;
      }
      await requireService().listIssues({ projectId: project.id, limit: 1 });
      const added = await addSubscription(ctx.db, {
        guildId: interaction.guildId,
        channelId,
        projectId: project.id,
        projectName: project.name,
        createdBy: interaction.user.id,
      });
      ctx.log.info(
        {
          guildId: interaction.guildId,
          channelId,
          projectId: project.id,
          actorId: interaction.user.id,
        },
        'Redmine subscription added',
      );
      await respond(
        interaction,
        added
          ? `<#${channelId}> now gets updates for ${project.name}. Everyone who can read the channel will see them.`
          : 'That channel is already subscribed.',
      );
    };

  const handlers: Record<string, Handler> = {
    projects: async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const { projects, total } = await client.listProjects();
      const lines = projects.map((p) => `\`${p.identifier}\` ${p.name}`);
      await respond(
        interaction,
        [
          ...lines,
          total > projects.length ? `…and ${total - projects.length} more` : '',
        ].join('\n') || 'No projects.',
      );
    },
    issues: async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const status = interaction.options.getString('status');
      const project = interaction.options.getString('project');
      const { issues, total } = await client.listIssues({
        ...(project === null ? {} : { projectId: project }),
        assignedToMe: interaction.options.getBoolean('mine') ?? false,
        status: status === 'closed' || status === '*' ? status : 'open',
        limit: 15,
      });
      const lines = issues.map((issue) => issueLine(baseUrl, issue));
      await respond(
        interaction,
        lines.length === 0
          ? 'No issues.'
          : `${lines.join('\n')}\n${issues.length} of ${total}`.slice(0, 2000),
      );
    },
    'issue view': async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const issue = await client.getIssue(
        interaction.options.getInteger('issue', true),
      );
      await respond(interaction, { embeds: [issueEmbed(baseUrl, issue)] });
    },
    'issue create': async (interaction, ctx) => {
      const { client, redmineUserId } = await clientFor(
        ctx,
        interaction.user.id,
      );
      const description = interaction.options.getString('description');
      const issue = await client.createIssue({
        project_id: interaction.options.getString('project', true),
        subject: interaction.options.getString('subject', true),
        ...(description === null ? {} : { description }),
        ...(interaction.options.getBoolean('assign_to_me') === true
          ? { assigned_to_id: redmineUserId }
          : {}),
      });
      await respond(interaction, `Created ${issueLine(baseUrl, issue)}`);
    },
    'issue update': async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const status = interaction.options.getInteger('status');
      const notes = interaction.options.getString('notes');
      if (status === null && notes === null) {
        throw new UserError('Give a new status or notes.');
      }
      const id = interaction.options.getInteger('issue', true);
      await client.updateIssue(id, {
        ...(status === null ? {} : { status_id: status }),
        ...(notes === null ? {} : { notes }),
      });
      await respond(interaction, `Updated #${id}.`);
    },
    'issue assign': async (interaction, ctx) => {
      const { client, redmineUserId } = await clientFor(
        ctx,
        interaction.user.id,
      );
      const member = interaction.options.getUser('member');
      let assignee = redmineUserId;
      if (member && member.id !== interaction.user.id) {
        const link = await getLink(ctx.db, member.id);
        if (!link) {
          throw new UserError(
            `${member.username} has not linked a Redmine account.`,
          );
        }
        assignee = link.redmineUserId;
      }
      const id = interaction.options.getInteger('issue', true);
      await client.updateIssue(id, { assigned_to_id: assignee });
      await respond(interaction, `Assigned #${id}.`);
    },
    'issue comment': async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const id = interaction.options.getInteger('issue', true);
      await client.updateIssue(id, {
        notes: interaction.options.getString('text', true),
      });
      await respond(interaction, `Commented on #${id}.`);
    },
    'issue remind': async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const issue = await client.getIssue(
        interaction.options.getInteger('issue', true),
      );
      if (issue.due_date === undefined || issue.due_date === null) {
        throw new UserError(`#${issue.id} has no due date.`);
      }
      const timezone = await getGuildTimezone(
        ctx.db,
        interaction.guildId,
        ctx.config.DEFAULT_TIMEZONE,
      );
      const runAt = DateTime.fromISO(issue.due_date, { zone: timezone })
        .minus({ days: interaction.options.getInteger('days_before') ?? 1 })
        .set({ hour: 9 })
        .toJSDate();
      if (runAt.getTime() <= Date.now()) {
        throw new UserError('That reminder time has already passed.');
      }
      const reminder = await createReminder(ctx, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        channelId: null,
        message: `Redmine #${issue.id} "${issue.subject}" is due ${issue.due_date}: ${baseUrl}issues/${issue.id}`,
        runAt,
        recurrence: null,
        timezone,
      });
      await respond(
        interaction,
        `I will DM you <t:${Math.floor(runAt.getTime() / 1000)}:R> (reminder #${reminder.id}).`,
      );
    },
    link: async (interaction) => {
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
    },
    unlink: async (interaction, ctx) => {
      const removed = await deleteLink(ctx.db, interaction.user.id);
      ctx.log.info(
        { userId: interaction.user.id, removed },
        'Redmine account unlinked',
      );
      await respond(
        interaction,
        removed ? 'Your Redmine key is deleted.' : 'You had no linked account.',
      );
    },
    subscribe: subscription('subscribe'),
    unsubscribe: subscription('unsubscribe'),
  };

  const linkModal: ComponentHandler = {
    prefix: 'redmine:link',
    execute: async (interaction, _args, ctx) => {
      if (!interaction.isModalSubmit()) {
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const apiKey = interaction.fields.getTextInputValue('key').trim();
      let user: RedmineUser;
      try {
        user = await new RedmineClient(baseUrl, apiKey).currentUser();
      } catch (error) {
        if (error instanceof RedmineError) {
          throw new UserError(
            error.kind === 'auth'
              ? 'Redmine did not accept that API key.'
              : error.message,
          );
        }
        throw error;
      }
      await saveLink(ctx.db, {
        userId: interaction.user.id,
        redmineUserId: user.id,
        redmineLogin: user.login,
        encryptedApiKey: box.encrypt(apiKey),
      });
      ctx.log.info(
        { userId: interaction.user.id, redmineUserId: user.id },
        'Redmine account linked',
      );
      await interaction.editReply(`Linked to Redmine user **${user.login}**.`);
    },
  };

  const command: SlashCommand = {
    data: data.toJSON(),
    permissions: {
      'issue create': 'redmine:issue:create',
      'issue update': 'redmine:issue:update',
      'issue comment': 'redmine:issue:update',
      'issue assign': 'redmine:issue:assign',
      subscribe: 'redmine:subscription:manage',
      unsubscribe: 'redmine:subscription:manage',
    },
    // Redmine can be slow, so everything but the modal is deferred first.
    execute: bySubcommand(
      Object.fromEntries(
        Object.entries(handlers).map(([path, handler]) => [
          path,
          path === 'link' ? handler : deferred(withRedmineErrors(handler)),
        ]),
      ),
    ),
    autocomplete: async (interaction, ctx) => {
      const { client } = await clientFor(ctx, interaction.user.id);
      const statuses = await client.listStatuses();
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
    jobs: notifications?.jobs ?? [],
    ...(notifications && { start: notifications.start }),
  };
}
