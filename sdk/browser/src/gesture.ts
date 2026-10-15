/**
 * Every pointerdown starts its own press.
 * An option inside the control that owned the previous press is still a new press.
 */
export function startOnPointerDown(previousContainsNext: boolean): boolean {
  if (previousContainsNext) {
    return true;
  }

  return true;
}

/** The click that completes the pointerdown already recorded must not start a second press. */
export function clickFollowsPress(
  sameTarget: boolean,
  targetIsInsidePress: boolean,
  pressIsInsideTarget: boolean,
): boolean {
  return sameTarget || targetIsInsidePress || pressIsInsideTarget;
}

/**
 * A request keeps the burst recorded when it was opened.
 * A click that becomes current only at send time must not take that request.
 * An opened request with no recorded burst stays unclaimed.
 */
export function burstForSend(
  recordedAtOpen: string | undefined,
  liveBurst: string | undefined,
  opened: boolean,
): string | undefined {
  if (opened) {
    return recordedAtOpen;
  }

  return liveBurst;
}

/** Replace any burst already stored in tracestate. Appending would leave the previous selection in place. */
export function traceStateWithBurst(traceState: string, burstId: string): string {
  const kept = traceState
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^newtrend-ai=/i.test(part) && !/^ai-newtrend=/i.test(part));

  return [`Newtrend-AI=${burstId}`, ...kept].join(',');
}
