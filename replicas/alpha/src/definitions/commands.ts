import { defineCommand } from "@reside/common/workflow"

export const helloCommand = defineCommand({
  name: "hello",
  title: "Say Hello",
  description: "A simple command that says hello.",
  protected: true,
  params: {
    name: {
      title: "Name",
      description: "The name of the person to greet.",
      type: "string",
      required: true,
    },
  },
})
