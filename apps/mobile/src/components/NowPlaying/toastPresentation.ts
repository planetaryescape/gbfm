type ToastNotice = { readonly message: string }

type ToastAnimation = {
  readonly stop: () => void
  readonly reset: () => void
  readonly animate: (
    target: 0 | 1,
    duration: number,
    complete?: (finished: boolean) => void,
  ) => void
}

type ScheduleHide = (delay: number, hide: () => void) => () => void

const scheduleHide: ScheduleHide = (delay, hide) => {
  const timer = setTimeout(hide, delay)

  return () => clearTimeout(timer)
}

export const presentToastNotice = <Notice extends ToastNotice>(
  notice: Notice,
  animation: ToastAnimation,
  announce: (message: string) => void,
  dismiss: (notice: Notice) => void,
  schedule: ScheduleHide = scheduleHide,
) => {
  announce(notice.message)
  animation.stop()
  animation.reset()
  animation.animate(1, 180)

  return schedule(2400, () => {
    animation.animate(0, 220, (finished) => {
      if (finished) dismiss(notice)
    })
  })
}
