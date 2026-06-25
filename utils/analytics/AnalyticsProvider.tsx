import React, { createContext, useContext } from 'react';

// FOSS placeholder: cloud builds replace this with PostHog-backed analytics.
// Public builds keep the same tracking API and intentionally discard events.

export type AnalyticsProperties = Record<string, unknown>;

const contextValue = {
  publicInstanceId: null,
  authBetaEnabled: false,
  posthogReady: false,
  capture: (_event: string, _properties?: AnalyticsProperties) => undefined,
};

const AnalyticsContext = createContext(contextValue);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return <AnalyticsContext.Provider value={contextValue}>{children}</AnalyticsContext.Provider>;
}

export const useAnalytics = () => useContext(AnalyticsContext);

export const trackRecordCreated = (_type: string, _properties?: AnalyticsProperties) => undefined;
export const trackHouseSwitched = () => undefined;
export const trackRecordImageAdded = (_type: string, _properties?: AnalyticsProperties) => undefined;
export const trackCsvExported = (_properties?: AnalyticsProperties) => undefined;
export const trackCsvImported = (_properties?: AnalyticsProperties) => undefined;
export const trackPdfExported = (_properties?: AnalyticsProperties) => undefined;
export const trackVoiceActionStartListeningPressed = (_properties?: AnalyticsProperties) => undefined;
export const trackBulkVoiceAddStartListeningPressed = (_properties?: AnalyticsProperties) => undefined;
export const trackInboxAutomaticOrganizePressed = (_properties?: AnalyticsProperties) => undefined;
