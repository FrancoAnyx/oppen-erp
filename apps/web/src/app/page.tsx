'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

const NAV = [
  { href: '/ventas',    icon: '📦', label: 'Ventas',     desc: 'Órdenes de venta' },
  { href: '/compras',   icon: '🛒', label: 'Compras',    desc: 'Órdenes de compra' },
  { href: '/productos', icon: '🗃️', label: 'Productos',  desc: 'Catálogo y stock' },
  { href: '/clientes',  icon: '👥', label: 'Clientes',   desc: 'Entidades' },
  { href: '/fiscal',    icon: '🧾', label: 'Fiscal',     desc: 'Facturas ARCA' },
  { href: '/cuentas',   icon: '💰', label: 'Cuentas',    desc: 'Cobros y pagos' },
];

export default function Dashboard() {
  const { user, token } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!token) router.push('/login'); }, [token, router]);
  if (!user) return <div className="flex h-screen items-center justify-center text-gray-400">Cargando...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-4 flex items-center justify-between shadow-sm">
        <span className="text-xl font-bold text-indigo-600">öppen</span>
        <span className="text-sm text-gray-500">{user.fullName} · {user.role}</span>
      </nav>
      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold mb-8">Dashboard</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {NAV.map(n => (
            <a key={n.href} href={n.href}
               className="bg-white rounded-xl p-6 border hover:border-indigo-400 hover:shadow-md transition-all">
              <div className="text-3xl mb-3">{n.icon}</div>
              <div className="font-semibold text-gray-800">{n.label}</div>
              <div className="text-sm text-gray-500 mt-1">{n.desc}</div>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
