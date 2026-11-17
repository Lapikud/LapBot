import type { Subscription } from '~/domain/issues';
export type TrackerRepository = {
  subscribe: (
    subscription: Omit<Subscription, 'id' | 'checkpoint'>,
  ) => Promise<boolean>;
  unsubscribe: (
    guildId: string,
    channelId: string,
    projectId: number,
  ) => Promise<boolean>;
  subscriptions: (afterId?: number, limit?: number) => Promise<Subscription[]>;
  setCheckpoint: (id: number, checkpoint: Date) => Promise<void>;
  claimNotification: (subscriptionId: number, key: string) => Promise<boolean>;
  releaseNotification: (subscriptionId: number, key: string) => Promise<void>;
};
