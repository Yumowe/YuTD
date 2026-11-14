import type { UnwrapSchema } from 'elysia'
import { t } from 'elysia'

export const ConfigModel = {
  config: t.Object({
    system: t.Object({
      host: t.String(),
      port: t.Number(),
    }),

    auth: t.Object({
      enabled: t.Boolean(),
      password: t.String(),
      expiresIn: t.String(),
      secret: t.String(),
    }),

  }),

  publicConfig: t.Object({
    system: t.Object({
      host: t.String(),
      port: t.Number(),
    }),

    auth: t.Object({
      enabled: t.Boolean(),
      expiresIn: t.String(),
    }),

  }),

  newConfig: t.Partial(
    t.Object({
      system: t.Partial(t.Object({
        host: t.String(),
        port: t.Number(),
      })),

      auth: t.Partial(t.Object({
        enabled: t.Boolean(),
        password: t.String(),
        expiresIn: t.String(),
      })),

    }),
  ),
} as const

export type ConfigModelType = {
  [k in keyof typeof ConfigModel]: UnwrapSchema<typeof ConfigModel[k]>
}
