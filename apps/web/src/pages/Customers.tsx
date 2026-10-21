import { useEffect, useState } from "react";
import { get, message } from "../api.ts";
import { Banner, Card, Empty, Page, dateTime, yuan } from "../ui.tsx";

interface Customer {
  id: string;
  name: string;
  phone: string;
  orderCount: number;
  totalFen: number;
  firstOrderAt: string;
  lastOrderAt: string;
}

function toCsv(rows: Customer[]) {
  const cell = (s: string | number) => `"${String(s).replaceAll('"', '""')}"`;
  const lines = [["称呼", "手机号", "订单数", "累计消费（元）", "首次下单", "最近下单"].map(cell).join(",")];
  for (const c of rows) {
    lines.push([c.name, c.phone, c.orderCount, (c.totalFen / 100).toFixed(2), dateTime(c.firstOrderAt), dateTime(c.lastOrderAt)].map(cell).join(","));
  }
  // BOM so Excel opens the Chinese text correctly.
  return `﻿${lines.join("\n")}`;
}

export function Customers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    get<Customer[]>("/api/merchant/customers").then(setCustomers, (e) => setError(message(e)));
  }, []);

  const q = query.trim();
  const shown = customers?.filter((c) => !q || c.name.includes(q) || c.phone.includes(q)) ?? [];

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(customers ?? [])], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "顾客名单.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Page
      title="顾客"
      actions={
        <button className="btn" onClick={exportCsv} disabled={!customers?.length}>
          导出
        </button>
      }
    >
      {error && <Banner tone="critical">{error}</Banner>}
      <p className="muted">每位付过款的顾客都会自动进入名单。名单属于你，随时可以导出。</p>
      <Card flush>
        <div className="card-header">
          <input className="input" placeholder="按称呼或手机号搜索" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {customers === null ? (
          <Empty>加载中…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{customers.length === 0 ? "还没有顾客。第一位顾客付款后会出现在这里。" : "没有符合的顾客"}</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>顾客</th>
                  <th className="num">订单</th>
                  <th className="num">累计消费</th>
                  <th>最近下单</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div>{c.name}</div>
                      <a className="subtle" href={`tel:${c.phone}`}>
                        {c.phone}
                      </a>
                    </td>
                    <td className="num">{c.orderCount}</td>
                    <td className="num">{yuan(c.totalFen)}</td>
                    <td>{dateTime(c.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
