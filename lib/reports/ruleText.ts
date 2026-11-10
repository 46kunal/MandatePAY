/** Guard rule codes in plain words (the same words the merchant UI uses). */
const RULE: Record<string, string> = {
  max_total: 'Budget',
  categories: 'Product category',
  max_quantity: 'Quantity',
  required_attributes: 'Size and attributes',
  deadline: 'Delivery deadline',
  approval_threshold: 'Approval limit',
  require_approval_over: 'Approval limit',
};

export function ruleText(rule: string): string {
  return RULE[rule] ?? rule.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
