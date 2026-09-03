import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ortakkasa.app",
  appName: "Ortak Kasa",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
