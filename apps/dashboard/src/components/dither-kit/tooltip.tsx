// @ts-nocheck — vendored dither-kit source (kept as shipped)
"use client"

import { AnimatePresence, motion } from "motion/react"
import {
  cloneElement,
  isValidElement,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { useCommonChart } from "./common-context"
import { cn } from "./lib"
import { rgb } from "./palette"

export type Placement = "top" | "right" | "bottom" | "left"

export interface TooltipProps {
  /** The element that triggers the tooltip. */
  children: ReactNode
  /** Tooltip content. */
  content: ReactNode
  /** Delay before showing the tooltip. */
  delay?: number
  /** Delay before hiding the tooltip. */
  closeDelay?: number
  /** Placement relative to the trigger. */
  placement?: Placement
  /** Distance from the trigger. */
  offset?: number
  /** Additional class for the tooltip container. */
  className?: string
  /** Additional class for the tooltip trigger. */
  triggerClassName?: string
  /** Prevent the tooltip from opening. */
  disabled?: boolean
  /** Allow focus and pointer interaction within the tooltip content. */
  interactive?: boolean
  /** Use the child element itself as the trigger. */
  asChild?: boolean
}

type TooltipPosition = {
  top: number
  left: number
}

const PLACEMENT_CLASS: Record<Placement, string> = {
  top: "-translate-x-1/2 -translate-y-full",
  right: "-translate-y-1/2",
  bottom: "-translate-x-1/2",
  left: "-translate-x-full -translate-y-1/2",
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const positionFor = (
  rect: DOMRect,
  placement: Placement,
  offset: number
): TooltipPosition => {
  if (placement === "top") {
    return { top: rect.top - offset, left: rect.left + rect.width / 2 }
  }
  if (placement === "bottom") {
    return { top: rect.bottom + offset, left: rect.left + rect.width / 2 }
  }
  if (placement === "left") {
    return { top: rect.top + rect.height / 2, left: rect.left - offset }
  }
  return { top: rect.top + rect.height / 2, left: rect.right + offset }
}

const assignRef = (
  ref: Ref<HTMLElement> | undefined,
  node: HTMLElement | null
) => {
  if (typeof ref === "function") {
    ref(node)
  } else if (ref) {
    ref.current = node
  }
}

export const Tooltip = ({
  children,
  content,
  delay = 150,
  closeDelay = 0,
  placement = "top",
  offset = 8,
  className,
  triggerClassName,
  disabled = false,
  interactive = false,
  asChild = false,
}: TooltipProps) => {
  const id = useId()
  const triggerRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLElement | null>(null)
  const showTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  const hovered = useRef(false)
  const focused = useRef(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const child = isValidElement(children) ? children : null
  const childProps = asChild && child ? child.props : {}

  const clearTimers = () => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current)
      showTimer.current = null
    }
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect || disabled) return
    setPosition(positionFor(rect, placement, offset))
  }

  const hide = () => setPosition(null)

  const scheduleShow = () => {
    clearTimers()
    if (disabled) return
    if (delay === 0) {
      show()
      return
    }
    showTimer.current = window.setTimeout(show, delay)
  }

  const scheduleHide = () => {
    if (hovered.current || focused.current) return
    clearTimers()
    if (closeDelay === 0) {
      hide()
      return
    }
    hideTimer.current = window.setTimeout(hide, closeDelay)
  }

  useEffect(() => clearTimers, [])

  useEffect(() => {
    if (disabled) {
      clearTimers()
      hide()
    }
  }, [disabled])

  useEffect(() => {
    if (!position) return
    const close = () => {
      clearTimers()
      hide()
    }
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!interactive) return
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return
      }
      hovered.current = false
      focused.current = false
      close()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [interactive, position])

  useLayoutEffect(() => {
    if (!position) return
    const rect = tooltipRef.current?.getBoundingClientRect()
    if (!rect) return
    const gutter = 12
    let x = 0
    let y = 0
    if (rect.left < gutter) x = gutter - rect.left
    if (rect.right > window.innerWidth - gutter) {
      x = window.innerWidth - gutter - rect.right
    }
    if (rect.top < gutter) y = gutter - rect.top
    if (rect.bottom > window.innerHeight - gutter) {
      y = window.innerHeight - gutter - rect.bottom
    }
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      setPosition((current) =>
        current ? { top: current.top + y, left: current.left + x } : current
      )
    }
  }, [position])

  const setTriggerRef = (node: HTMLElement | null) => {
    triggerRef.current = node
    if (asChild && child) {
      assignRef(childProps.ref, node)
    }
  }

  const focusAfterTrigger = () => {
    const focusable = [...document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter(
        (element) =>
          element.getClientRects().length > 0 &&
          !tooltipRef.current?.contains(element)
      )
    const index = triggerRef.current ? focusable.indexOf(triggerRef.current) : -1
    focusable[index + 1]?.focus()
  }

  const triggerProps = {
    ref: setTriggerRef,
    "aria-describedby": position && !interactive
      ? [childProps["aria-describedby"], id].filter(Boolean).join(" ")
      : childProps["aria-describedby"],
    "aria-controls": position && interactive ? id : childProps["aria-controls"],
    "aria-expanded": interactive
      ? position !== null
      : childProps["aria-expanded"],
    "aria-haspopup": interactive ? "dialog" : childProps["aria-haspopup"],
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(event)
      hovered.current = true
      scheduleShow()
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(event)
      hovered.current = false
      scheduleHide()
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event)
      focused.current = event.currentTarget.matches(":focus-visible")
      if (focused.current) {
        scheduleShow()
      }
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event)
      focused.current = false
      scheduleHide()
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      childProps.onPointerDown?.(event)
      focused.current = false
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      childProps.onClick?.(event)
      if (!interactive) return
      clearTimers()
      if (position && !hovered.current) {
        hide()
      } else {
        show()
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(event)
      if (event.key === "Escape" && position) {
        event.preventDefault()
        clearTimers()
        hide()
        return
      }
      if (interactive && position && event.key === "Tab" && !event.shiftKey) {
        const first = tooltipRef.current?.querySelector<HTMLElement>(
          FOCUSABLE_SELECTOR
        )
        if (first) {
          event.preventDefault()
          first.focus()
        }
      }
    },
  }

  const mergedClassName =
    typeof childProps.className === "function"
      ? (...args: unknown[]) => cn(childProps.className(...args), triggerClassName)
      : cn(childProps.className, triggerClassName)

  const trigger =
    asChild && child ? (
      cloneElement(child, {
        ...triggerProps,
        className: mergedClassName,
      })
    ) : (
      <span
        {...triggerProps}
        className={cn("inline-flex", triggerClassName)}
      >
        {children}
      </span>
    )

  return (
    <>
      {trigger}
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {position && (
                <motion.span
                  ref={tooltipRef}
                  id={id}
                  role={interactive ? "dialog" : "tooltip"}
                  aria-label={interactive ? "More information" : undefined}
                  onMouseEnter={
                    interactive
                      ? () => {
                          hovered.current = true
                          clearTimers()
                        }
                      : undefined
                  }
                  onMouseLeave={
                    interactive
                      ? () => {
                          hovered.current = false
                          scheduleHide()
                        }
                      : undefined
                  }
                  onFocusCapture={
                    interactive
                      ? () => {
                          focused.current = true
                          clearTimers()
                        }
                      : undefined
                  }
                  onBlurCapture={
                    interactive
                      ? (event) => {
                          if (event.currentTarget.contains(event.relatedTarget)) {
                            return
                          }
                          focused.current = false
                          scheduleHide()
                        }
                      : undefined
                  }
                  onKeyDown={
                    interactive
                      ? (event) => {
                          if (event.key === "Escape") {
                            event.preventDefault()
                            clearTimers()
                            hide()
                            triggerRef.current?.focus()
                            return
                          }
                          if (event.key !== "Tab") return
                          const focusable = [
                            ...event.currentTarget.querySelectorAll<HTMLElement>(
                              FOCUSABLE_SELECTOR
                            ),
                          ]
                          const index = focusable.indexOf(
                            document.activeElement as HTMLElement
                          )
                          if (event.shiftKey && index === 0) {
                            event.preventDefault()
                            triggerRef.current?.focus()
                          } else if (!event.shiftKey && index === focusable.length - 1) {
                            event.preventDefault()
                            clearTimers()
                            hide()
                            focusAfterTrigger()
                          }
                        }
                      : undefined
                  }
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  style={{ top: position.top, left: position.left }}
                  className={cn(
                    "fixed z-50 whitespace-nowrap border border-border bg-popover px-2 py-1 font-mono text-[11px] text-popover-foreground shadow-sm",
                    interactive ? "pointer-events-auto" : "pointer-events-none",
                    PLACEMENT_CLASS[placement],
                    className
                  )}
                >
                  {content}
                </motion.span>
              )}
            </AnimatePresence>,
            document.body
          )
        : null}
    </>
  )
}

export type TooltipVariant = "default" | "frosted-glass"

const VARIANT: Record<TooltipVariant, string> = {
  default: "bg-popover",
  "frosted-glass": "bg-popover/70 backdrop-blur-sm",
}

/**
 * Floating chart tooltip. Reads the shared common context so it works in every
 * chart family and dims unselected series or slices.
 */
export const ChartTooltip = ({
  labelKey,
  valueFormatter,
  variant = "default",
}: {
  labelKey?: string
  valueFormatter?: (value: number, name: string) => string
  variant?: TooltipVariant
}) => {
  const chart = useCommonChart()
  const show = chart.ready && chart.hoverIndex != null

  const [lastIndex, setLastIndex] = useState(0)
  if (chart.hoverIndex != null && chart.hoverIndex !== lastIndex) {
    setLastIndex(chart.hoverIndex)
  }
  const index = chart.hoverIndex ?? lastIndex

  const heading = chart.heading(index, labelKey)
  const items = chart.itemsAt(index)

  return (
    <AnimatePresence>
      {show && items.length > 0 && (
        <motion.div
          key="dither-tooltip"
          initial={{
            opacity: 0,
            x: "-50%",
            y: "-115%",
            top: chart.tooltipTop,
            left: chart.tooltipLeft,
          }}
          animate={{
            opacity: 1,
            x: "-50%",
            y: "-115%",
            top: chart.tooltipTop,
            left: chart.tooltipLeft,
          }}
          exit={{ opacity: 0 }}
          transition={{
            type: "spring",
            stiffness: 520,
            damping: 38,
            mass: 0.6,
          }}
          className={cn(
            "pointer-events-none absolute z-10 whitespace-nowrap border px-2 py-1 shadow-sm",
            VARIANT[variant]
          )}
        >
          {heading && (
            <div className="mb-0.5 font-mono text-[10px] text-muted-foreground">
              {heading}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-1.5 font-mono text-[11px] text-popover-foreground tabular-nums"
                style={{ opacity: item.dimmed ? 0.4 : 1 }}
              >
                <span
                  className="size-2"
                  style={{ backgroundColor: rgb(item.seed.fill) }}
                />
                <span className="text-muted-foreground">{item.label}</span>
                <span className="ml-auto pl-2 text-foreground">
                  {valueFormatter
                    ? valueFormatter(item.value, item.name)
                    : item.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

ChartTooltip.chartLayer = "dom" as const
