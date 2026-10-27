import type { Round } from "@/engine/games/crackTheCode";

/** Each round's guesses with feedback: present = right digit, exact = right place. */
export function CtcRounds({ history, labels }: { history: Round[]; labels: [string, string] }) {
  if (!history.length) return <p className="text-sm text-gray-500">No rounds played yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500">
          <th className="py-1">Round</th>
          <th>{labels[0]}</th>
          <th>{labels[1]}</th>
        </tr>
      </thead>
      <tbody>
        {history.map((r) => (
          <tr key={r.round} className="border-t border-gray-100">
            <td className="py-1">{r.round}</td>
            {r.guesses.map((g, seat) => (
              <td key={seat}>
                {g ? (
                  <>
                    <span className="font-mono">{g.code}</span>{" "}
                    <span className="text-xs text-gray-500">
                      {g.present} present · {g.exact} exact
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">no guess</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
