import { supabase } from './supabase';
import { rpc } from './api';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Returns an i18n key describing the problem, or null if the file is acceptable. */
export function validateReceipt(f: File): string | null {
  if (!ALLOWED.includes(f.type)) return 'expense.receiptType';
  if (f.size > MAX_RECEIPT_BYTES) return 'expense.receiptTooLarge';
  return null;
}

export async function uploadReceipt(groupId: string, expenseId: string, file: File) {
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' } as Record<string, string>)[file.type] ?? 'bin';
  const path = `${groupId}/${expenseId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  await rpc('add_receipt', { p_expense_id: expenseId, p_path: path, p_mime: file.type, p_size: file.size });
  return path;
}
