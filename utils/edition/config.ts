export type EverfindEdition = 'foss' | 'cloud';

export type EditionCapabilities = {
  analytics: boolean;
  authentication: boolean;
  cloudSync: boolean;
  collaboration: boolean;
  mcp: boolean;
  naturalLanguageProcessing: boolean;
  siri: boolean;
  voice: boolean;
};

export const everfindEdition: EverfindEdition = 'foss';

export const editionCapabilities: EditionCapabilities = {
  analytics: false,
  authentication: false,
  cloudSync: false,
  collaboration: false,
  mcp: false,
  naturalLanguageProcessing: false,
  siri: false,
  voice: true,
};

export const hasEditionCapability = (capability: keyof EditionCapabilities) =>
  editionCapabilities[capability];
