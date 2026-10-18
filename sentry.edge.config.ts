// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn, isCommunityDsn } from "./lib/sentry/dsn";
import { opcoesDePrivacidade } from "./lib/sentry/privacidade";

const sentryDsn = resolveSentryDsn(process.env.SENTRY_DSN);

Sentry.init({
  dsn: sentryDsn,

  // No Sentry da comunidade, só erro (issue #100). Ver isCommunityDsn().
  // Fora dela: 5%, decisão da RonalDigital em 2026-10-18 (P0-3). 100% de trace num
  // CRM com cron de minuto é o maior multiplicador de cota do Sentry, e 5% já
  // dimensiona latência. O zero da comunidade não muda — a política de lá é dela.
  tracesSampleRate: isCommunityDsn(sentryDsn) ? 0 : 0.05,

  // Coleta restrita + scrub, num ponto só (Sentry 11 coleta amplo por default).
  ...opcoesDePrivacidade,
});
