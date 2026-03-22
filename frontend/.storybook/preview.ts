import type { Preview } from "@storybook/react";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        {
          name: "light",
          value: "#F8FAFC",
        },
        {
          name: "dark",
          value: "#0F172A",
        },
        {
          name: "white",
          value: "#FFFFFF",
        },
      ],
    },
  },
};

export default preview;

