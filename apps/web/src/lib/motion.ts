import type { Variants } from "motion/react";

export const spring = {
  enter: { type: "spring", stiffness: 380, damping: 36 },
  layout: { type: "spring", stiffness: 500, damping: 42 },
  emphasis: { type: "spring", stiffness: 600, damping: 20 },
} as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: spring.enter },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

export const stagger = (delay = 0.05): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: delay } },
});

export const popIn: Variants = {
  hidden: { scale: 0.85, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: spring.emphasis },
};

export const slideRight: Variants = {
  hidden: { x: -12, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: spring.enter },
};
