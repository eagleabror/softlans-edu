import { useEffect, useState } from "react";
import { api } from "./api";
type Named = { id: string; name: string; active?: boolean };
/** Optional allocation for NEW receipts only. Failure never assigns a default account. */
export function CashAccountField() {
  const [accounts, setAccounts] = useState<Named[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ accounts: Named[] }>("/cash/draft-options")
      .then((r) => {
        if (live) setAccounts(r.accounts);
      })
      .catch(() => {
        if (live) setAccounts([]);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <label>
      Kassa yoki bank hisobi (ixtiyoriy)
      <select name="cashAccountId" className="plain-input">
        <option value="">Hisobga taqsimlanmagan</option>
        {accounts
          ?.filter((a) => a.active !== false)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <small>
        Faqat ushbu yangi to‘lovga tegishli. Tarixiy yozuvlar o‘zgarmaydi.
      </small>
    </label>
  );
}
