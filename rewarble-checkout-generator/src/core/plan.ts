import { z } from "zod";

/** Our internal cart plan. This (and only this) is what a public link carries. No merchant session state. */
export const CartPlanSchema = z.object({
  v: z.literal(1),
  merchant: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  mode: z.enum(["auto", "manual"]),
  requestedAmount: z.number().int().positive(), // minor units, Rewarble face value
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        faceValue: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  iat: z.number().int(), // issued-at, unix seconds
});
export type CartPlan = z.infer<typeof CartPlanSchema>;

export function planTotal(plan: Pick<CartPlan, "items">): number {
  return plan.items.reduce((sum, i) => sum + i.faceValue * i.quantity, 0);
}
