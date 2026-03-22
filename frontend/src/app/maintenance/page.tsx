'use client';

import { PowerOff } from 'lucide-react';
import Image from 'next/image';

export default function MaintenancePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 px-4">
      <div className="w-full max-w-2xl text-center space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <Image
            src="/box.svg"
            alt="AI Refill Logo"
            width={80}
            height={80}
            className="w-20 h-20 opacity-80"
          />
          <h1 className="text-5xl font-bold text-primary">AI Refill</h1>
        </div>

        {/* Hero Icon */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"></div>
            <div className="relative bg-muted/50 p-8 rounded-full border-2 border-primary/30">
              <PowerOff className="w-24 h-24 text-primary/70" strokeWidth={1.5} />
            </div>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-3xl md:text-4xl font-bold text-foreground leading-tight">
          Los motores de Inteligencia Artificial están apagados temporalmente.
        </h2>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Por favor contacte a la administración para volver a encenderlos.
        </p>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-border/50">
          <div className="text-center text-sm text-muted-foreground">
            <p>Powered by Artificial Intelligence Developments © 2026</p>
          </div>
        </div>
      </div>
    </div>
  );
}
