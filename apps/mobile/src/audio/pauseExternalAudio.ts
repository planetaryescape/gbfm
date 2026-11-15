export async function pauseExternalAudio<Controller>(
  current: () => Controller | null,
  pause: (controller: Controller) => Promise<boolean>,
): Promise<boolean> {
  const controller = current()

  if (controller === null) return true

  const paused = await pause(controller)

  return paused && current() === controller
}
