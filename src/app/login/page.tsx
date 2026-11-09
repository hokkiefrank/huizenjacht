import { redirect } from "next/navigation";
import { login } from "@/app/actions";
import { AuthForm } from "@/components/auth-form";
import { getUser } from "@/lib/auth";

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <div className="card mx-auto mt-10 max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">Inloggen</h1>
      <AuthForm action={login} withEmail submitLabel="Inloggen" />
    </div>
  );
}
