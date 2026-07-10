"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminLink() {
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setIsSuperadmin(Boolean(data.isSuperadmin)))
      .catch(() => setIsSuperadmin(false));
  }, []);

  if (!isSuperadmin) return null;

  return (
    <Link href="/admin" className="text-sm text-gray-600 hover:underline">
      Administrar accesos
    </Link>
  );
}
