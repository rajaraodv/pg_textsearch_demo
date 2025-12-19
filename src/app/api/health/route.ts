import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query('SELECT NOW() as time, current_database() as db');
    return NextResponse.json({
      status: 'ok',
      time: result.rows[0].time,
      database: result.rows[0].db,
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    return NextResponse.json(
      { status: 'error', message: String(error) },
      { status: 500 }
    );
  }
}

