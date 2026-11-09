import { acceptInvite } from "@/app/actions";
import { AuthForm } from "@/components/auth-form";

export default async function InvitePage({ params }: PageProps<"/uitnodiging/[token]">) {
  const { token } = await params;
  return (
    <div className="card mx-auto mt-10 max-w-sm p-6">
      <h1 className="mb-1 text-xl font-semibold">Welkom! 🏡</h1>
      <p className="mb-4 text-sm text-stone-500">Kies een wachtwoord om je account te activeren.</p>
      <AuthForm action={acceptInvite.bind(null, token)} withEmail={false} submitLabel="Account activeren" />
    </div>
  );
}
