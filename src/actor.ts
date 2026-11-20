import { Actor, log } from "apify";
import { runActorJob, type ActorIO } from "./actor/job.js";

await Actor.init();

try {
  const input = await Actor.getInput();
  const manager = Actor.getChargingManager();
  const payPerEvent = manager.getPricingInfo().isPayPerEvent;

  const io: ActorIO = {
    // Plain pushData (no event name): billing is done explicitly below, so a failed run is never charged.
    pushPack: (pack) => Actor.pushData(pack),
    saveOutput: (pack) => Actor.setValue("OUTPUT", pack),
    async charge(eventName, count) {
      try {
        const result = await Actor.charge({ eventName, count });
        if (result.chargedCount < count) {
          log.warning(`Charged ${result.chargedCount} of ${count} "${eventName}" events (spending limit reached).`);
        }
      } catch (err) {
        log.warning(`Could not charge "${eventName}": ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    maxCharges: (eventName) => (payPerEvent ? manager.calculateMaxEventChargeCountWithinLimit(eventName) : Infinity),
    async setStatus(message) {
      await Actor.setStatusMessage(message);
    },
  };

  const callActor = async (actorId: string, actorInput: unknown): Promise<unknown[]> => {
    // The called Actor bills the account running this one. Only reached when the user opted in.
    const run = await Actor.call(actorId, actorInput, { waitSecs: 120 });
    if (run.status !== "SUCCEEDED") throw new Error(`${actorId} ended with status ${run.status}`);
    const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 50 });
    return items;
  };

  const result = await runActorJob(input, { fetch, callActor }, io);
  if (result.ok) {
    await Actor.exit(result.message);
  } else {
    log.error(result.message);
    await Actor.fail(result.message);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  log.error(`Unexpected failure: ${message}`);
  await Actor.fail(`Unexpected failure: ${message}`);
}
