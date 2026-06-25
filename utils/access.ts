export type EffectiveAccessSnapshot = {
  planId: string;
  isPaid: boolean;
  periodEnd: string | null;
  graceUntil: string | null;
  features: string[];
};

const LOCAL_ACCESS: EffectiveAccessSnapshot = {
  planId: 'local',
  isPaid: false,
  periodEnd: null,
  graceUntil: null,
  features: [],
};

export const getEffectiveAccessSnapshot = async () => LOCAL_ACCESS;
export const hasFeatureEnabled = async (_featureId: string) => false;
