module.exports = {
  appId: "cn.shanhaiedu.studio",
  productName: "ShanHaiEdu Studio",
  asar: true,
  asarUnpack: ["desktop-bundle/**", "node_modules/**"],
  extraMetadata: {
    description: "ShanHaiEdu local lesson media production studio.",
    author: "ShanHaiEdu",
  },
  directories: {
    output: "dist-desktop",
  },
  files: [
    "desktop/**",
    "package.json",
    "desktop-bundle/**",
    "public/**",
  ],
  win: {
    icon: "desktop/assets/icon.ico",
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: false,
  },
};
