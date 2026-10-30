import type { Domain, TwinSpec } from "@/engine/schema";
import { CREATOR_SYSTEM, mockCreatorTwin } from "./creator";
import { mockPortTwin, PORT_SYSTEM } from "./port";

/** Everything domain-specific lives in a template; the engine is shared. */
export type Template = {
  system: string;
  mock: (text: string) => TwinSpec;
  /** Extra guidance for the scenario and fix agents. */
  agentHints: string;
};

export const TEMPLATES: Record<Domain, Template> = {
  port: {
    system: PORT_SYSTEM,
    mock: mockPortTwin,
    agentHints:
      "Domain: port terminal. When sources disagree, trust physical measurements (scale, reefer_sensor) and authorities (customs) over paperwork (carrier). Classic conflicts: declared empty vs heavy on the scale, customs hold during a lane outage, reefer drifting warm while the carrier says OK, free time running out while lanes are down.",
  },
  creator: {
    system: CREATOR_SYSTEM,
    mock: mockCreatorTwin,
    agentHints:
      "Domain: interactive object for a game or robot. Classic interaction bugs: two rules fighting over the same state (chattering doors, grippers that open and close every frame), a person/object standing still in a safety zone, sensors flickering, inputs arriving in an unexpected order, power loss mid-motion, a safety rule that only works in one state. Use signal sources 'sensor' and 'user'.",
  },
};
