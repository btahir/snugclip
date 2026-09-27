// Imported first: counts every native AudioEncoder created in this realm and records its config.
export const audioEncoders: { configs: unknown[]; created: number } = { configs: [], created: 0 };
const G = globalThis as unknown as { AudioEncoder?: any };
if (G.AudioEncoder) {
  const Native = G.AudioEncoder;
  G.AudioEncoder = class extends Native {
    constructor(init: unknown) { super(init); audioEncoders.created++; }
    configure(cfg: unknown) { audioEncoders.configs.push(cfg); return super.configure(cfg); }
  };
  G.AudioEncoder.isConfigSupported = Native.isConfigSupported.bind(Native);
}
