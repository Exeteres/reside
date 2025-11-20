import { defineCommand } from "citty"
import { getOrCreateAgeIdentity, loadLocalConfig, logger, saveLocalConfig } from "../../shared"
import { createJazzContextForNewAccount } from "jazz-tools"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { armor, Encrypter, identityToRecipient } from "age-encryption"
import { hostname } from "node:os"

export const createAccountCommand = defineCommand({
  args: {
    name: {
      type: "positional",
      description: "The name of the new account.",
      required: true,
    },
  },

  meta: {
    description:
      "Create a new Jazz account and store its credentials locally. The account can be used across multiple clusters.",
  },

  async run({ args }) {
    const localConfig = await loadLocalConfig()
    if (localConfig.accounts.find(a => a.name === args.name)) {
      throw new Error(`An account with the name "${args.name}" already exists in the local config.`)
    }

    const { account, logOut } = await createJazzContextForNewAccount({
      creationProps: { name: args.name },
      crypto: await WasmCrypto.create(),
      peers: [],
    })

    const identity = await getOrCreateAgeIdentity()
    const recipient = await identityToRecipient(identity)

    const encrypter = new Encrypter()
    encrypter.addRecipient(recipient)

    const encrypted = await encrypter.encrypt(account.$jazz.localNode.agentSecret)
    const armored = armor.encode(encrypted)

    localConfig.accounts.push({
      name: args.name,
      accountId: account.$jazz.id,
      recipients: [
        {
          recipient,
          label: hostname(),
        },
      ],
      encryptedAgentSecret: armored,
    })

    await saveLocalConfig(localConfig)
    await logOut()

    logger.info(`account with ID "%s" created and saved to local config`, account.$jazz.id)
  },
})
