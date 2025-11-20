import { experimental_defineRequest } from "jazz-tools"

export const callTelegramApi = experimental_defineRequest({
  url: "",
  workerId: "",
  request: {
    schema: {},
  },
  response: {
    schema: {},
  },
})
