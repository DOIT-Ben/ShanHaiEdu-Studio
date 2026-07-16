import type { Model } from "@openai/agents";

import {
  resolveProviderLedgerConfig,
  type ProviderLedgerEnv,
} from "@/server/provider-ledger/provider-ledger-adapter";

import { createAgentsSdkRuntimeAbAdapter } from "./agents-sdk-adapter";
import { createResponsesRuntimeAbAdapter } from "./responses-adapter";
import type { RuntimeAbAdapter, RuntimeAbResponsesClient } from "./types";

type LedgerFactoryBase = {
  ledgerRoot?: string;
  capability: string;
  ambientEnv?: ProviderLedgerEnv;
};

type LedgerFactoryInput = LedgerFactoryBase & (
  | {
      runtimeKind: "responses";
      transport: { client: RuntimeAbResponsesClient };
    }
  | {
      runtimeKind: "agents_sdk";
      transport: { model: Model };
    }
);

export type RuntimeAbProviderContract = {
  runtimeKind: "responses" | "agents_sdk";
  providerId: string;
  purpose: "main_agent_responses";
  endpointCategory: "openai_compatible_responses";
  model: string;
  adoptionStatus: "evaluation_only" | "not_adopted";
  evaluationOnly: true;
  productionEligible: false;
  providerRequests: 0;
};

export function createLedgerBoundRuntimeAbAdapter(input: LedgerFactoryInput): {
  adapter: RuntimeAbAdapter;
  contract: RuntimeAbProviderContract;
} {
  const config = resolveProviderLedgerConfig({
    ledgerRoot: input.ledgerRoot,
    ambientEnv: input.ambientEnv,
    capability: input.capability,
    purpose: "main_agent_responses",
  });
  const adapter = input.runtimeKind === "responses"
    ? createResponsesRuntimeAbAdapter({ client: input.transport.client })
    : createAgentsSdkRuntimeAbAdapter({ model: input.transport.model });

  return {
    adapter,
    contract: Object.freeze({
      runtimeKind: input.runtimeKind,
      providerId: config.providerId,
      purpose: "main_agent_responses",
      endpointCategory: config.endpointCategory,
      model: config.model,
      adoptionStatus: "evaluation_only",
      evaluationOnly: true,
      productionEligible: false,
      providerRequests: 0,
    }),
  };
}
