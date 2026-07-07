module.exports = {
  appId: "cn.shanhaiedu.studio",
  productName: "ShanHaiEdu Studio",
  asar: false,
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
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
};
