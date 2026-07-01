export const loadRemotePlanLimitData = async (): Promise<unknown | null> => null;

export const getFallbackPlanLimitInfo = <T>(limits: T) => ({
  planId: 'foss',
  limits,
});
