// Minimal Storybook main configuration to force webpack5 builder
module.exports = {
  core: {
    builder: "webpack5",
  },
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-links",
    "@storybook/addon-actions"
  ],
  framework: {
    name: "@storybook/react",
    options: {}
  }
};

