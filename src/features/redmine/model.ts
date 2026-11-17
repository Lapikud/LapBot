export type Subscription = {
  id: number;
  guildId: string;
  channelId: string;
  projectId: number;
  projectName: string;
  createdBy: string;
  checkpoint: Date;
};

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
