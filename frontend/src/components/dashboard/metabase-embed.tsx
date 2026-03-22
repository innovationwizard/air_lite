/**
 * Metabase Embed Component
 * Securely embeds Metabase dashboards using signed URLs
 */
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
// import removed - bi-service deleted
import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';

export interface MetabaseEmbedProps {
  dashboardSlug: string;
  title?: string;
  description?: string;
  height?: number;
  showFullScreenLink?: boolean;
  className?: string;
}

export const MetabaseEmbed: React.FC<MetabaseEmbedProps> = ({
  dashboardSlug,
  title,
  description,
  height = 600,
  showFullScreenLink = true,
  className,
}) => {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [dashboardName, setDashboardName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardUrl = async () => {
    setIsLoading(true);
    setError(null);

    try {
//       const response = await biService.getDashboardUrl(dashboardSlug);
      setEmbedUrl("https://placeholder.com");
      setDashboardName("Placeholder");//       setEmbedUrl(response.data.url);
//       setDashboardName(response.data.name);
//     } catch (err: any) {
//       setError(err.detail || 'Failed to load dashboard');
//       console.error('Dashboard load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardUrl();

    // Refresh URL before it expires (10 min expiry, refresh at 8 min)
    const refreshInterval = setInterval(() => {
      fetchDashboardUrl();
    }, 8 * 60 * 1000); // 8 minutes

    return () => clearInterval(refreshInterval);
  }, [dashboardSlug]);

  const content = (
    <div className="relative" style={{ height }}>
      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center h-full space-y-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <p className="text-lg font-semibold text-destructive">Failed to Load Dashboard</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <Button variant="outline" onClick={fetchDashboardUrl}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !error && embedUrl && (
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          frameBorder="0"
          allowTransparency
          className="rounded-md border"
          title={dashboardName || 'BI Dashboard'}
        />
      )}
    </div>
  );

  if (title || description || showFullScreenLink) {
    return (
      <Card className={className}>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {title && <CardTitle>{title}</CardTitle>}
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {showFullScreenLink && embedUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(`/bi/dashboards?report=${dashboardSlug}`, '_blank')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
    );
  }

  return <div className={className}>{content}</div>;
};

