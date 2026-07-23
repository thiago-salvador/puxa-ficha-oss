import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import {
  ALERT_VERIFICATION_EMAIL_COOLDOWN_MS,
  alertBodyStringField,
  buildAlertDeleteDataUrl,
  buildAlertManageAccessEmail,
  buildAlertManageUrl,
  buildAlertVerificationEmail,
  buildAlertVerifyUrl,
  createAlertToken,
  createAlertVerifyExpiryDate,
  createAlertsServiceRoleClient,
  encryptAlertManageToken,
  extractClientIp,
  findPublicCandidateBySlug,
  findSubscriberByEmailHash,
  findSubscriberByManageToken,
  hashAlertEmail,
  hashAlertIp,
  hashAlertToken,
  maskAlertEmail,
  normalizeAlertEmail,
  normalizeCandidateSlug,
} from "@/lib/alerts"
import {
  readAlertManageTokenCookie,
  resolveAlertManageToken,
  setAlertManageTokenCookie,
} from "@/lib/alerts-session"
import { rejectCrossSiteAlertsMutation } from "@/lib/alerts-csrf"
import { logAlertsApiExit, logAlertsEvent } from "@/lib/alerts-log"
import { sendTransactionalEmail } from "@/lib/email"
import {
  isRequestBodyTooLargeError,
  readJsonBodyWithLimit,
} from "@/lib/request-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_NEW_SUBSCRIBERS_PER_HOUR = 24
type AlertsServiceRoleClient = ReturnType<typeof createAlertsServiceRoleClient>

interface SubscribeDeps {
  createAlertsServiceRoleClient: typeof createAlertsServiceRoleClient
  findPublicCandidateBySlug: typeof findPublicCandidateBySlug
  findSubscriberByEmailHash: typeof findSubscriberByEmailHash
  findSubscriberByManageToken: typeof findSubscriberByManageToken
  sendTransactionalEmail: typeof sendTransactionalEmail
  logAlertsApiExit: typeof logAlertsApiExit
  logAlertsEvent: typeof logAlertsEvent
  now: () => Date
}

const defaultSubscribeDeps: SubscribeDeps = {
  createAlertsServiceRoleClient,
  findPublicCandidateBySlug,
  findSubscriberByEmailHash,
  findSubscriberByManageToken,
  sendTransactionalEmail,
  logAlertsApiExit,
  logAlertsEvent,
  now: () => new Date(),
}

function optionalName(body: unknown): string | null {
  const normalized = alertBodyStringField(body, "nome").trim()
  return normalized ? normalized.slice(0, 120) : null
}

async function markVerificationEmailSent(
  supabase: AlertsServiceRoleClient,
  subscriberId: string,
  candidateSlug: string,
  failureEvent: string,
  deps: Pick<SubscribeDeps, "logAlertsEvent">,
): Promise<void> {
  const { error } = await supabase
    .from("alert_subscribers")
    .update({
      last_verification_email_sent_at: new Date().toISOString(),
    })
    .eq("id", subscriberId)

  if (error) {
    deps.logAlertsEvent({
      route: "subscribe",
      event: failureEvent,
      level: "warn",
      detail: {
        candidateSlug,
        message: error.message?.slice(0, 200),
      },
    })
  }
}

export function createSubscribeHandler(deps: SubscribeDeps = defaultSubscribeDeps) {
  return async function POST(req: NextRequest) {
    const csrfResponse = rejectCrossSiteAlertsMutation(req, "subscribe", deps.logAlertsApiExit)
    if (csrfResponse) return csrfResponse

    let body: unknown
    try {
      body = await readJsonBodyWithLimit(req)
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        deps.logAlertsApiExit("subscribe", 413, "body_too_large")
        return NextResponse.json({ error: "Payload too large" }, { status: 413 })
      }
      deps.logAlertsApiExit("subscribe", 400, "invalid_json")
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const email = normalizeAlertEmail(alertBodyStringField(body, "email"))
    const candidateSlug = normalizeCandidateSlug(alertBodyStringField(body, "candidateSlug"))
    const manageToken = resolveAlertManageToken([
      alertBodyStringField(body, "manageToken"),
      readAlertManageTokenCookie(req),
    ])
    const nome = optionalName(body)

    if (!email || !candidateSlug) {
      deps.logAlertsApiExit("subscribe", 400, "invalid_payload")
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    const candidate = await deps.findPublicCandidateBySlug(candidateSlug)
    if (!candidate) {
      deps.logAlertsApiExit("subscribe", 404, "candidate_not_found", { candidateSlug })
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 })
    }

    const emailHash = hashAlertEmail(email)
    const existingSubscriber = await deps.findSubscriberByEmailHash(emailHash)
    const supabase = deps.createAlertsServiceRoleClient()
    const requestTime = deps.now()
    const now = requestTime.getTime()
    const lastVerificationSentAt = existingSubscriber?.last_verification_email_sent_at
      ? new Date(existingSubscriber.last_verification_email_sent_at).getTime()
      : 0
    const cooldownActive =
      Boolean(existingSubscriber) &&
      lastVerificationSentAt > 0 &&
      now - lastVerificationSentAt < ALERT_VERIFICATION_EMAIL_COOLDOWN_MS

    if (existingSubscriber?.verified) {
      if (!manageToken) {
        if (cooldownActive) {
          deps.logAlertsApiExit("subscribe", 200, "verified_manage_link_cooldown", {
            candidateSlug: candidate.slug,
            cooldownActive: true,
          })
          return NextResponse.json({
            ok: true,
            verified: true,
            manageLinkSent: true,
            cooldownActive: true,
            emailMasked: maskAlertEmail(email),
            candidateSlug: candidate.slug,
          })
        }

        const nextManageToken = createAlertToken()
        const manageTokenHash = hashAlertToken(nextManageToken)
        const manageTokenCiphertext = encryptAlertManageToken(nextManageToken)
        const manageUrl = buildAlertManageUrl(nextManageToken)
        const deleteDataUrl = buildAlertDeleteDataUrl(nextManageToken)
        const accessEmail = buildAlertManageAccessEmail({
          candidateName: candidate.nome_urna,
          manageUrl,
          deleteDataUrl,
        })

        const { error: updateError } = await supabase
          .from("alert_subscribers")
          .update({
            manage_token_hash: manageTokenHash,
            manage_token_ciphertext: manageTokenCiphertext,
          })
          .eq("id", existingSubscriber.id)

        if (updateError) {
          deps.logAlertsApiExit("subscribe", 503, "db_refresh_manage_access_failed")
          return NextResponse.json({ error: "Could not refresh manage access" }, { status: 503 })
        }

        try {
          await deps.sendTransactionalEmail({
            to: email,
            subject: accessEmail.subject,
            text: accessEmail.text,
            html: accessEmail.html,
          })
        } catch {
          deps.logAlertsApiExit("subscribe", 503, "manage_access_email_failed")
          return NextResponse.json(
            { error: "Não foi possível enviar o link de gestão agora." },
            { status: 503 },
          )
        }

        await markVerificationEmailSent(
          supabase,
          existingSubscriber.id,
          candidate.slug,
          "manage_access_sent_timestamp_update_failed",
          deps,
        )

        deps.logAlertsApiExit("subscribe", 200, "verified_manage_link_sent", {
          candidateSlug: candidate.slug,
        })
        return NextResponse.json({
          ok: true,
          verified: true,
          manageLinkSent: true,
          emailMasked: maskAlertEmail(email),
          candidateSlug: candidate.slug,
        })
      }

      const authorizedSubscriber = await deps.findSubscriberByManageToken(manageToken)
      if (!authorizedSubscriber || authorizedSubscriber.id !== existingSubscriber.id) {
        deps.logAlertsApiExit("subscribe", 403, "invalid_manage_token_verified_flow")
        return NextResponse.json({ error: "Invalid manage token" }, { status: 403 })
      }

      const { error: upsertError } = await supabase.from("alert_subscriptions").upsert(
        {
          subscriber_id: existingSubscriber.id,
          candidato_id: candidate.id,
        },
        { onConflict: "subscriber_id,candidato_id", ignoreDuplicates: true },
      )

      if (upsertError) {
        deps.logAlertsApiExit("subscribe", 503, "db_upsert_subscription_failed_verified")
        return NextResponse.json({ error: "Could not update subscription" }, { status: 503 })
      }

      deps.logAlertsApiExit("subscribe", 200, "verified_following", { candidateSlug: candidate.slug })
      return setAlertManageTokenCookie(
        NextResponse.json({
          ok: true,
          verified: true,
          following: true,
          candidateSlug: candidate.slug,
        }),
        manageToken,
      )
    }

    const ipHash = hashAlertIp(extractClientIp(req.headers))

    if (!existingSubscriber) {
      const since = new Date(now - 3_600_000).toISOString()
      const { count, error: countError } = await supabase
        .from("alert_subscribers")
        .select("*", { count: "exact", head: true })
        .eq("ip_consentimento_hash", ipHash)
        .gte("created_at", since)

      if (countError) {
        deps.logAlertsApiExit("subscribe", 503, "rate_check_failed")
        return NextResponse.json({ error: "Rate check failed" }, { status: 503 })
      }

      if ((count ?? 0) >= MAX_NEW_SUBSCRIBERS_PER_HOUR) {
        deps.logAlertsApiExit("subscribe", 429, "rate_limit_new_subscribers_hour")
        return NextResponse.json({ error: "Too many requests" }, { status: 429 })
      }
    }

    if (existingSubscriber && cooldownActive) {
      const { error: subscriptionError } = await supabase.from("alert_subscriptions").upsert(
        {
          subscriber_id: existingSubscriber.id,
          candidato_id: candidate.id,
        },
        { onConflict: "subscriber_id,candidato_id", ignoreDuplicates: true },
      )

      if (subscriptionError) {
        deps.logAlertsApiExit("subscribe", 503, "db_pending_subscription_cooldown_failed")
        return NextResponse.json({ error: "Could not save pending subscription" }, { status: 503 })
      }

      deps.logAlertsApiExit("subscribe", 200, "requires_verification_cooldown", {
        candidateSlug: candidate.slug,
      })
      return NextResponse.json({
        ok: true,
        requiresVerification: true,
        cooldownActive: true,
        emailMasked: maskAlertEmail(email),
        candidateSlug: candidate.slug,
      })
    }

    const verifyToken = createAlertToken()
    const nextManageToken = createAlertToken()
    const verifyTokenHash = hashAlertToken(verifyToken)
    const manageTokenHash = hashAlertToken(nextManageToken)
    const manageTokenCiphertext = encryptAlertManageToken(nextManageToken)
    const verifyExpiresAt = createAlertVerifyExpiryDate(requestTime).toISOString()

    let subscriberId = existingSubscriber?.id ?? null

    if (existingSubscriber) {
      const { error: updateError } = await supabase
        .from("alert_subscribers")
        .update({
          email,
          nome,
          verify_token_hash: verifyTokenHash,
          verify_token_expires_at: verifyExpiresAt,
          manage_token_hash: manageTokenHash,
          manage_token_ciphertext: manageTokenCiphertext,
          ip_consentimento_hash: ipHash,
        })
        .eq("id", existingSubscriber.id)

      if (updateError) {
        deps.logAlertsApiExit("subscribe", 503, "db_update_subscriber_failed")
        return NextResponse.json({ error: "Could not update subscriber" }, { status: 503 })
      }

      subscriberId = existingSubscriber.id
    } else {
      const { data: insertedSubscriber, error: insertError } = await supabase
        .from("alert_subscribers")
        .insert({
          email,
          email_hash: emailHash,
          nome,
          verify_token_hash: verifyTokenHash,
          verify_token_expires_at: verifyExpiresAt,
          manage_token_hash: manageTokenHash,
          manage_token_ciphertext: manageTokenCiphertext,
          ip_consentimento_hash: ipHash,
        })
        .select("id")
        .single()

      if (insertError || !insertedSubscriber) {
        deps.logAlertsApiExit("subscribe", 503, "db_insert_subscriber_failed")
        return NextResponse.json({ error: "Could not create subscriber" }, { status: 503 })
      }

      subscriberId = insertedSubscriber.id
    }

    if (!subscriberId) {
      deps.logAlertsApiExit("subscribe", 503, "subscriber_id_missing_after_upsert")
      return NextResponse.json({ error: "Could not create subscriber" }, { status: 503 })
    }

    const { error: subscriptionError } = await supabase.from("alert_subscriptions").upsert(
      {
        subscriber_id: subscriberId,
        candidato_id: candidate.id,
      },
      { onConflict: "subscriber_id,candidato_id", ignoreDuplicates: true },
    )

    if (subscriptionError) {
      deps.logAlertsApiExit("subscribe", 503, "db_create_subscription_failed")
      return NextResponse.json({ error: "Could not create subscription" }, { status: 503 })
    }

    const verifyUrl = buildAlertVerifyUrl(verifyToken, nextManageToken)
    const manageUrl = buildAlertManageUrl(nextManageToken)
    const deleteDataUrl = buildAlertDeleteDataUrl(nextManageToken)
    const emailPayload = buildAlertVerificationEmail({
      candidateName: candidate.nome_urna,
      verifyUrl,
      manageUrl,
      deleteDataUrl,
    })

    try {
      await deps.sendTransactionalEmail({
        to: email,
        subject: emailPayload.subject,
        text: emailPayload.text,
        html: emailPayload.html,
      })
    } catch {
      deps.logAlertsApiExit("subscribe", 503, "verification_email_send_failed")
      return NextResponse.json(
        { error: "Não foi possível enviar o e-mail de confirmação agora." },
        { status: 503 },
      )
    }

    await markVerificationEmailSent(
      supabase,
      subscriberId,
      candidate.slug,
      "verification_email_sent_timestamp_update_failed",
      deps,
    )

    deps.logAlertsApiExit("subscribe", 200, "requires_verification_email_sent", {
      candidateSlug: candidate.slug,
    })
    return NextResponse.json({
      ok: true,
      requiresVerification: true,
      emailMasked: maskAlertEmail(email),
      candidateSlug: candidate.slug,
    })
  }
}

export const POST = createSubscribeHandler()
